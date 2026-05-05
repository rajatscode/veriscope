// explore.ts — Main explore() function: backward-cone-driven state exploration

import { coverage, type AssertionMetadata, type CircuitGraph, type CoverageReport, type GraphEvent, type OperationStatus } from '@veriscope/graph';
import { backwardCone } from './backward-solve.js';
import { inferBoundaryValues, parseComputeFn } from './fn-parser.js';
import type { ExploreOptions, ExploreResult, ScenarioTrace, Violation } from './types.js';

type GraphNodeRef = NonNullable<ReturnType<CircuitGraph['getNode']>>;

/**
 * Explore the state space of a reactive graph by:
 * 1. Finding assertions
 * 2. Computing backward cones to identify relevant root signals
 * 3. Enumerating boolean combinations for small cones
 * 4. Resolving pending eventually assertions
 * 5. Running adversarial pass to break assertions
 * 6. Collecting coverage data
 */
export async function explore(graph: CircuitGraph, options: ExploreOptions = {}): Promise<ExploreResult> {
  const budget = options.budget ?? 1000;
  const flush = options.flush ?? (() => {});
  const violations: Violation[] = [];
  const scenarios: ExploreResult['scenarios'] = [];
  let steps = 0;
  let scenarioCounter = 0;
  let stoppedByBudget = false;
  let hiddenDuplicateCases = 0;
  let budgetAttempted = false;
  const seenScenarioKeys = new Set<string>();

  graph.enterTestMode();
  coverage.reset();
  graph.enableCoverage();
  for (const op of graph.getOperations()) {
    const outcomes = op.metadata?.outcomes ?? op.metadata?.outcomeDomain;
    if (Array.isArray(outcomes)) {
      coverage.declareOperationOutcomes(op.name, outcomes.map(String));
    }
    if (op.status !== 'pending') {
      coverage.recordOperationOutcome(op.name, op.status);
    }
  }
  for (const model of graph.getOperationModels()) {
    coverage.declareOperationOutcomes(model.name, model.outcomes);
  }

  // Save original signal values so we can restore after exploration
  const signalNodes = graph.getNodes().filter(n => n.type === 'signal' && n.getValue);
  recordInitialReachableCoverage(signalNodes);
  const savedValues = new Map<string, any>();
  for (const node of signalNodes) {
      savedValues.set(node.id, node.getValue!());
  }
  const savedOperations = graph.getOperations();

  try {
    // 1. Discover assertions
    const assertions = graph.getAssertions();
    const checkedAssertionNames = assertions.map(assertion => assertion.name);
    declareTransitionDomains(signalNodes, assertions);
    const restoreScenarioBaseline = async () => {
      graph.restoreOperations(savedOperations);
      await restoreSavedSignalValues(graph, signalNodes, savedValues, flush);
    };

    // 2. For each assertion, find its upstream roots
    for (const assertion of assertions) {
      const roots = backwardCone(graph, assertion.id);
      const rootNodes = roots
        .map(id => graph.getNode(id))
        .filter((n): n is NonNullable<typeof n> => n != null);

      // 3a. Separate boolean and non-boolean roots
      const boolRoots = rootNodes.filter(n => {
        if (!n.getValue) return false;
        const v = n.getValue();
        return typeof v === 'boolean';
      });

      const nonBoolRootCandidates = rootNodes.filter(n => {
        if (!n.getValue) return false;
        const v = n.getValue();
        return typeof v !== 'boolean';
      });

      // 3b. Determine non-boolean domains from graph metadata, assertion
      // comparisons, then optional declared opaque domains.
      const nonBoolDomains = new Map<string, any[]>();
      const nonBoolRoots: typeof nonBoolRootCandidates = [];
      for (const node of nonBoolRootCandidates) {
        const domain = domainForExplorationNode(node, assertion, assertions, graph);
        if (domain.length > 0) {
          nonBoolDomains.set(node.id, domain);
          nonBoolRoots.push(node);
        }
      }

      const boolDomains = new Map<string, any[]>();
      for (const node of boolRoots) {
        const declaredDomain = domainForNode(assertion.metadata?.domains, node)
          ?? coverageDomainForNode(assertions, node);
        const domain = declaredDomain && declaredDomain.length > 0
          ? declaredDomain.filter(value => typeof value === 'boolean')
          : [false, true];
        boolDomains.set(node.id, domain.length > 0 ? domain : [false, true]);
      }

      const boolComboCount = boolRoots.reduce(
        (total, node) => total * Math.max(boolDomains.get(node.id)?.length ?? 0, 1),
        1,
      );
      const nonBoolComboCount = nonBoolRoots.reduce(
        (total, node) => total * Math.max(nonBoolDomains.get(node.id)?.length ?? 0, 1),
        1,
      );
      const totalCombos = Math.max(1, boolComboCount * nonBoolComboCount);

      if ((boolRoots.length > 0 || nonBoolRoots.length > 0) && rootNodes.length <= 15) {
        // 4. Enumerate combinations of booleans × non-boolean value variants
        for (let i = 0; i < totalCombos; i++) {
          if (steps >= budget) {
            budgetAttempted = true;
            break;
          }
          await restoreScenarioBaseline();
          const boolIdx = i % boolComboCount;
          const nonBoolIdx = Math.floor(i / boolComboCount);
          const boolCombo = boolRoots.map((node, j) => {
            const values = boolDomains.get(node.id) ?? [false, true];
            return valueForDomainIndex(boolIdx, boolRoots, boolDomains, j, values);
          });

          const eventMarker = markEvents(graph);
          graph.openTick();

          // Set boolean roots
          boolRoots.forEach((node, j) => {
            if (node.setValue) {
              graph.driveNodeValue(node.id, boolCombo[j]);
            }
          });

          // Set non-boolean roots
          nonBoolRoots.forEach((node, j) => {
            if (node.setValue && node.type === 'signal') {
              const values = nonBoolDomains.get(node.id) ?? [node.getValue?.()];
              const valueToSet = valueForDomainIndex(nonBoolIdx, nonBoolRoots, nonBoolDomains, j, values);
              graph.driveNodeValue(node.id, valueToSet);
            }
          });

          await flush();

          // Check assertions
          const v = graph.checkAssertions();
          graph.closeTick();
          const observations = observationsSince(graph, eventMarker);

          const sequence = [
            ...boolCombo.map((val, j) => ({
              signal: boolRoots[j].name,
              value: val,
            })),
            ...nonBoolRoots.map((n) => ({
              signal: n.name,
              value: n.getValue?.(),
            })),
          ];
          hiddenDuplicateCases += recordScenario(scenarios, seenScenarioKeys, {
            id: `scenario-${scenarioCounter++}`,
            kind: 'enumerated',
            tick: graph.currentTick,
            steps: sequence,
            assertions: checkedAssertionNames,
            violations: v.map(violation => violation.name),
            observations,
          });

          if (v.length > 0) {
            const signalValues: Record<string, any> = {};
            boolRoots.forEach((n, j) => {
              signalValues[n.name] = boolCombo[j];
            });
            nonBoolRoots.forEach((n) => {
              signalValues[n.name] = n.getValue?.();
            });

            for (const violation of v) {
              violations.push({
                assertionName: violation.name,
                tick: graph.currentTick,
                signalValues,
                sequence,
              });
            }
          }

          // 5. Check for pending eventually assertions and try to resolve them
          await resolveEventuallyAssertions(graph, assertions, rootNodes, flush);

          steps++;
        }
      } else if (boolRoots.length === 0 && nonBoolRoots.length === 0) {
        // No roots found — just check assertion at current state
        await restoreScenarioBaseline();
        const eventMarker = markEvents(graph);
        graph.openTick();
        await flush();
        const v = graph.checkAssertions();
        graph.closeTick();
        hiddenDuplicateCases += recordScenario(scenarios, seenScenarioKeys, {
          id: `scenario-${scenarioCounter++}`,
          kind: 'current-state',
          tick: graph.currentTick,
          steps: [],
          assertions: checkedAssertionNames,
          violations: v.map(violation => violation.name),
          observations: observationsSince(graph, eventMarker),
        });
        if (v.length > 0) {
          for (const violation of v) {
            violations.push({
              assertionName: violation.name,
              tick: graph.currentTick,
              signalValues: {},
              sequence: [],
            });
          }
        }
        steps++;
      }
    }

    // 6. Sequence exploration — explicitly arm temporal assertions and try
    // property-domain follow-up steps.
    if (steps < budget) {
      const sequenceResult = await sequenceExploration(
        graph,
        assertions,
        flush,
        restoreScenarioBaseline,
        budget - steps,
        scenarioCounter,
      );
      violations.push(...sequenceResult.violations);
      hiddenDuplicateCases += recordScenarios(scenarios, seenScenarioKeys, sequenceResult.scenarios);
      stoppedByBudget = stoppedByBudget || sequenceResult.stoppedByBudget;
      steps += sequenceResult.steps;
      scenarioCounter = sequenceResult.nextScenarioCounter;
    }

    // 7. Operation outcome exploration — complete declared external operation
    // models across their outcome domains and run their modeled handlers.
    if (steps < budget) {
      const operationResult = await operationOutcomeExploration(
        graph,
        checkedAssertionNames,
        flush,
        restoreScenarioBaseline,
        budget - steps,
        scenarioCounter,
      );
      violations.push(...operationResult.violations);
      hiddenDuplicateCases += recordScenarios(scenarios, seenScenarioKeys, operationResult.scenarios);
      stoppedByBudget = stoppedByBudget || operationResult.stoppedByBudget;
      steps += operationResult.steps;
      scenarioCounter = operationResult.nextScenarioCounter;
    }

    // 8. Coverage-directed pass — use current coverage gaps to drive missing
    // toggles/transitions before generic completion.
    if (steps < budget) {
      const coverageDirected = await coverageDirectedPass(
        graph,
        checkedAssertionNames,
        assertions,
        flush,
        restoreScenarioBaseline,
        budget - steps,
        scenarioCounter,
      );
      violations.push(...coverageDirected.violations);
      hiddenDuplicateCases += recordScenarios(scenarios, seenScenarioKeys, coverageDirected.scenarios);
      stoppedByBudget = stoppedByBudget || coverageDirected.stoppedByBudget;
      steps += coverageDirected.steps;
      scenarioCounter = coverageDirected.nextScenarioCounter;
    }

    // 9. Adversarial pass — try to break each assertion
    if (steps < budget) {
      const advViolations = await adversarialPass(graph, assertions, flush, restoreScenarioBaseline, budget - steps);
      violations.push(...advViolations.violations);
      hiddenDuplicateCases += recordScenarios(scenarios, seenScenarioKeys, advViolations.scenarios);
      stoppedByBudget = stoppedByBudget || advViolations.stoppedByBudget;
      steps += advViolations.steps;
    }

    // 10. Coverage completion pass — drive untoggled booleans and FSM state transitions
    if (steps < budget) {
      for (const node of signalNodes) {
        if (steps >= budget) {
          budgetAttempted = true;
          break;
        }
        if (!node.setValue) continue;

        const currentVal = node.getValue?.();

        if (typeof currentVal === 'boolean') {
          // Toggle through declared assertion domain values when present,
          // otherwise cover both boolean values.
          const values = coverageDomainForNode(assertions, node)
            ?.filter((value): value is boolean => typeof value === 'boolean') ?? [true, false];
          for (const val of values.length > 0 ? values : [true, false]) {
            if (steps >= budget) {
              budgetAttempted = true;
              break;
            }
            await restoreScenarioBaseline();
            const eventMarker = markEvents(graph);
            graph.openTick();
            graph.driveNodeValue(node.id, val);
            await flush();
            graph.closeTick();
            hiddenDuplicateCases += recordScenario(scenarios, seenScenarioKeys, {
              id: `scenario-${scenarioCounter++}`,
              kind: 'coverage-completion',
              tick: graph.currentTick,
              steps: [{ signal: node.name, value: val }],
              assertions: checkedAssertionNames,
              violations: [],
              observations: observationsSince(graph, eventMarker),
            });
            steps++;
          }
        }

        const stateDomain = node.metadata?.states && Array.isArray(node.metadata.states)
          ? node.metadata.states
          : coverageDomainForNode(assertions, node);
        const states = (stateDomain ?? [])
          .filter((state): state is string => typeof state === 'string')
          .filter((state, index, all) => all.indexOf(state) === index);

        // FSM signals with known states — drive ordered pairs so transition
        // coverage observes A->B, not just isolated state values.
        if (states.length > 1) {
          for (const from of states) {
            for (const to of states) {
              if (steps >= budget) {
                budgetAttempted = true;
                break;
              }
              if (Object.is(from, to)) continue;
              await restoreScenarioBaseline();
              const eventMarker = markEvents(graph);
              const scenarioSteps: Array<{ signal: string; value: any }> = [];

              graph.openTick();
              graph.driveNodeValue(node.id, from);
              scenarioSteps.push({ signal: node.name, value: from });
              await flush();
              graph.closeTick();
              steps++;
              if (steps >= budget) {
                hiddenDuplicateCases += recordScenario(scenarios, seenScenarioKeys, {
                  id: `scenario-${scenarioCounter++}`,
                  kind: 'coverage-completion',
                  tick: graph.currentTick,
                  steps: scenarioSteps,
                  assertions: checkedAssertionNames,
                  violations: [],
                  observations: observationsSince(graph, eventMarker),
                });
                break;
              }

              graph.openTick();
              graph.driveNodeValue(node.id, to);
              scenarioSteps.push({ signal: node.name, value: to });
              await flush();
              graph.closeTick();
              steps++;

              hiddenDuplicateCases += recordScenario(scenarios, seenScenarioKeys, {
                id: `scenario-${scenarioCounter++}`,
                kind: 'coverage-completion',
                tick: graph.currentTick,
                steps: scenarioSteps,
                assertions: checkedAssertionNames,
                violations: [],
                observations: observationsSince(graph, eventMarker),
              });
            }
          }
        }
      }
    }

    const report = coverage.getReport();
    stoppedByBudget = stoppedByBudget || budgetAttempted;
    const summarizedCoverage = summarizeCoverage(report);
    const plan = summarizePlan(scenarios, summarizedCoverage, budget, stoppedByBudget, hiddenDuplicateCases);
    return {
      violations,
      coverage: summarizedCoverage,
      steps,
      scenarios,
      plan,
      snapshot: graph.snapshot({ tool: '@veriscope/test/explore', steps, deterministic: plan.deterministic, stoppedByBudget: plan.stoppedByBudget }),
    };
  } finally {
    graph.disableCoverage();
    graph.restoreOperations(savedOperations);
    graph.openTick();
    for (const node of signalNodes) {
      if (node.setValue && savedValues.has(node.id)) {
        const savedValue = savedValues.get(node.id);
        if (!Object.is(node.getValue?.(), savedValue)) {
          graph.driveNodeValue(node.id, savedValue);
        }
      }
    }
    graph.closeTick();
    graph.exitTestMode();
  }
}

function domainForNode(domains: Record<string, any[]> | undefined, node: GraphNodeRef): any[] | undefined {
  return domains?.[node.id] ?? domains?.[node.stablePath] ?? domains?.[node.name];
}

function coverageDomainForNode(
  assertions: Array<{ metadata?: AssertionMetadata }>,
  node: GraphNodeRef,
): any[] | undefined {
  const values: any[] = [];
  for (const assertion of assertions) {
    const domain = domainForNode(assertion.metadata?.domains, node);
    if (!domain) continue;
    for (const value of domain) {
      if (!values.some(existing => Object.is(existing, value))) values.push(value);
    }
  }
  return values.length > 0 ? values : undefined;
}

function recordInitialReachableCoverage(signalNodes: GraphNodeRef[]): void {
  for (const node of signalNodes) {
    const value = node.getValue?.();
    if (typeof value === 'boolean') {
      coverage.recordToggle(node.id, value);
    }
  }
}

async function restoreSavedSignalValues(
  graph: CircuitGraph,
  signalNodes: GraphNodeRef[],
  savedValues: Map<string, any>,
  flush: () => void | Promise<void>,
): Promise<void> {
  const resets = signalNodes
    .filter(node => node.setValue && savedValues.has(node.id))
    .map(node => ({ node, value: savedValues.get(node.id) }))
    .filter(({ node, value }) => !Object.is(node.getValue?.(), value));

  if (resets.length === 0) return;

  graph.disableCoverage();
  let tickOpened = false;
  try {
    graph.openTick();
    tickOpened = true;
    for (const { node, value } of resets) {
      graph.driveNodeValue(node.id, value);
    }
    await flush();
  } finally {
    if (tickOpened) graph.closeTick();
    graph.enableCoverage();
  }
}

function declareTransitionDomains(
  signalNodes: GraphNodeRef[],
  assertions: Array<{ metadata?: AssertionMetadata }>,
): void {
  for (const node of signalNodes) {
    const states = metadataStateDomain(node) ?? coverageDomainForNode(assertions, node);
    if (!states || states.length < 2) continue;

    const finiteStates = uniqueValues(states)
      .filter(state => state === null || ['boolean', 'number', 'string'].includes(typeof state))
      .map(String);
    if (finiteStates.length > 1) coverage.declareTransitionStates(node.id, finiteStates);
  }
}

function metadataStateDomain(node: GraphNodeRef): any[] | undefined {
  const states = node.metadata?.states;
  return Array.isArray(states) && states.length > 0 ? uniqueValues(states) : undefined;
}

function domainForExplorationNode(
  node: GraphNodeRef,
  assertion: AssertionInfo,
  assertions: AssertionInfo[],
  graph: CircuitGraph,
): any[] {
  const declaredDomain = domainForNode(assertion.metadata?.domains, node)
    ?? metadataStateDomain(node)
    ?? coverageDomainForNode(assertions, node);
  const inferredDomain = inferBoundariesForNode(node, assertions, graph);
  const reachableInferred = constrainToDeclaredDomain(inferredDomain, declaredDomain);
  if (reachableInferred.length > 0) return reachableInferred;
  if (declaredDomain && declaredDomain.length > 0) return uniqueValues(declaredDomain);

  const currentVal = node.getValue?.();
  if (isOpaqueRootValue(currentVal)) return [];
  if (currentVal === null) return [null, 'value'];
  if (typeof currentVal === 'string') return uniqueValues([currentVal, 'value']);
  if (typeof currentVal === 'number') return uniqueValues([currentVal, 0, 1]);
  return currentVal === undefined ? [] : uniqueValues([currentVal]);
}

function constrainToDeclaredDomain(
  inferredDomain: any[] | undefined,
  declaredDomain: any[] | undefined,
): any[] {
  if (!inferredDomain || inferredDomain.length === 0) return [];
  if (!declaredDomain || declaredDomain.length === 0) return uniqueValues(inferredDomain);
  return uniqueValues(inferredDomain.filter(inferred =>
    declaredDomain.some(declared => Object.is(inferred, declared)),
  ));
}

function inferBoundariesForNode(
  node: GraphNodeRef,
  assertions: AssertionInfo[],
  graph: CircuitGraph,
): any[] | undefined {
  const allBoundaries: any[] = [];

  for (const assertion of assertions) {
    const cone = upstreamCone(graph, assertion.id);
    if (!cone.includes(node.id)) continue;

    const checkFn = graph.getAssertionUserCheckFn(assertion.id) ?? assertion.checkFn;
    collectBoundariesFromFn(checkFn, node, allBoundaries);

    for (const coneNodeId of cone) {
      const coneNode = graph.getNode(coneNodeId);
      if (coneNode?.computeFn) {
        collectBoundariesFromFn(coneNode.computeFn, node, allBoundaries);
      }
    }
  }

  if (allBoundaries.length > 0) {
    const current = node.getValue?.();
    if (current !== undefined && !allBoundaries.some(value => Object.is(value, current))) {
      allBoundaries.unshift(current);
    }
  }

  return allBoundaries.length > 0 ? allBoundaries : undefined;
}

function upstreamCone(graph: CircuitGraph, targetNodeId: string): string[] {
  const visited = new Set<string>();
  const queue = [targetNodeId];
  const edges = graph.getEdges();

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    for (const edge of edges) {
      if (edge.to === nodeId) queue.push(edge.from);
    }
  }

  visited.delete(targetNodeId);
  return [...visited];
}

function collectBoundariesFromFn(fn: () => any, node: GraphNodeRef, target: any[]): void {
  const parsed = parseComputeFn(fn);
  if (!parsed) return;
  const boundaries = inferBoundaryValues(parsed.comparisons);
  const shortName = node.name.includes('.') ? node.name.split('.').at(-1) : undefined;
  const shortPath = node.stablePath.includes('.') ? node.stablePath.split('.').at(-1) : undefined;
  const nodeBoundaries = boundaries.get(node.name)
    ?? boundaries.get(node.stablePath)
    ?? boundaries.get(node.id)
    ?? (shortName ? boundaries.get(shortName) : undefined)
    ?? (shortPath ? boundaries.get(shortPath) : undefined);
  if (!nodeBoundaries) return;
  for (const value of nodeBoundaries) {
    if (!target.some(existing => Object.is(existing, value))) target.push(value);
  }
}

function isOpaqueRootValue(value: unknown): boolean {
  return value !== null && (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol');
}

function markEvents(graph: CircuitGraph): Set<GraphEvent> {
  return new Set(graph.getRecentEvents(256));
}

function observationsSince(graph: CircuitGraph, before: Set<GraphEvent>): ScenarioTrace['observations'] {
  const eventTypes = new Set<GraphEvent['type']>([
    'signal-change',
    'derived-recompute',
    'assertion-armed',
    'assertion-passed',
    'assertion-failed',
    'operation-begin',
    'operation-resolve',
    'operation-reject',
    'operation-abort',
    'operation-timeout',
    'operation-stale',
  ]);
  return graph.getRecentEvents(256)
    .filter(event => !before.has(event) && eventTypes.has(event.type))
    .map(event => ({
      type: event.type as NonNullable<ScenarioTrace['observations']>[number]['type'],
      node: graph.getNode(event.nodeId)?.name ?? event.stablePath ?? event.nodeId,
      oldValue: event.oldValue,
      newValue: event.newValue,
      operationId: event.operationId,
      operationName: event.operationName,
      status: event.status,
    }));
}

function driveValueForAssertion(
  metadata: AssertionMetadata | undefined,
  assertions: Array<{ metadata?: AssertionMetadata }>,
  node: NonNullable<ReturnType<CircuitGraph['getNode']>>,
  desiredValue: unknown,
): { driveable: true; value: unknown } | { driveable: false } {
  const declaredDomain = domainForNode(metadata?.domains, node)
    ?? coverageDomainForNode(assertions, node);
  if (declaredDomain && declaredDomain.length > 0) {
    const value = declaredDomain.some(domainValue => Object.is(domainValue, desiredValue))
      ? desiredValue
      : declaredDomain[0];
    return { driveable: true, value };
  }

  if (isOpaqueRootValue(node.getValue?.())) {
    return { driveable: false };
  }

  return { driveable: true, value: desiredValue };
}

function valueForDomainIndex(
  comboIndex: number,
  roots: Array<NonNullable<ReturnType<CircuitGraph['getNode']>>>,
  domains: Map<string, any[]>,
  rootIndex: number,
  values: any[],
): any {
  let divisor = 1;
  for (let i = 0; i < rootIndex; i++) {
    divisor *= Math.max(domains.get(roots[i].id)?.length ?? 0, 1);
  }
  return values[Math.floor(comboIndex / divisor) % values.length];
}

function summarizeCoverage(report: CoverageReport): ExploreResult['coverage'] {
  const toggleCovered = report.toggle.reduce(
    (sum, entry) => sum + (entry.seenTrue ? 1 : 0) + (entry.seenFalse ? 1 : 0),
    0,
  );
  const toggleTotal = report.toggle.length * 2;
  const transitionsCovered = report.transitions.reduce((sum, entry) => sum + entry.transitions.size, 0);
  const transitionsTotal = report.transitions.reduce((sum, entry) => {
    const stateCount = entry.states.size;
    return sum + (stateCount > 1 ? stateCount * (stateCount - 1) : entry.transitions.size);
  }, 0);
  const crossCovered = report.cross.reduce((sum, entry) => sum + entry.observed.size, 0);
  const crossTotal = report.cross.reduce((sum, entry) => sum + entry.total, 0);
  const operationsCovered = report.operations.reduce(
    (sum, entry) =>
      sum + [...entry.declaredOutcomes].filter(outcome => entry.observedOutcomes.has(outcome)).length,
    0,
  );
  const operationsTotal = report.operations.reduce((sum, entry) => sum + entry.declaredOutcomes.size, 0);

  return {
    toggle: metric(toggleCovered, toggleTotal),
    transitions: metric(transitionsCovered, transitionsTotal),
    cross: metric(crossCovered, crossTotal),
    operations: metric(operationsCovered, operationsTotal),
    overall: {
      covered: report.summary.coveredPoints,
      total: report.summary.totalPoints,
      percentage: report.summary.percentage,
    },
    gaps: report.gaps,
  };
}

function metric(covered: number, total: number) {
  return {
    covered,
    total,
    percentage: total > 0 ? (covered / total) * 100 : 100,
  };
}

function summarizePlan(
  scenarios: ScenarioTrace[],
  coverageSummary: ExploreResult['coverage'],
  budget: number,
  stoppedByBudget: boolean,
  hiddenDuplicateCases: number,
): ExploreResult['plan'] {
  const phaseCounts: ExploreResult['plan']['phaseCounts'] = {
    enumerated: 0,
    'current-state': 0,
    sequence: 0,
    'operation-outcome': 0,
    'coverage-directed': 0,
    'coverage-completion': 0,
    adversarial: 0,
  };

  for (const scenario of scenarios) {
    phaseCounts[scenario.kind]++;
  }

  const generatedReachableCoverage = stoppedByBudget
    ? coverageSummary.overall
    : metric(coverageSummary.overall.total, coverageSummary.overall.total);

  return {
    deterministic: true,
    budget,
    exhausted: !stoppedByBudget,
    stoppedByBudget,
    generatedCases: scenarios.length,
    hiddenDuplicateCases,
    generatedReachableCoverage,
    phaseCounts,
  };
}

function recordScenarios(
  scenarios: ScenarioTrace[],
  seenScenarioKeys: Set<string>,
  nextScenarios: ScenarioTrace[],
): number {
  let hidden = 0;
  for (const scenario of nextScenarios) {
    hidden += recordScenario(scenarios, seenScenarioKeys, scenario);
  }
  return hidden;
}

function recordScenario(
  scenarios: ScenarioTrace[],
  seenScenarioKeys: Set<string>,
  scenario: ScenarioTrace,
): number {
  const key = scenarioKey(scenario);
  if (seenScenarioKeys.has(key)) return 1;
  seenScenarioKeys.add(key);
  scenarios.push(scenario);
  return 0;
}

function scenarioKey(scenario: ScenarioTrace): string {
  const steps = scenario.steps
    .map(step => `${step.signal}=${stableValueKey(step.value)}`)
    .join(',');
  return `${scenario.kind}|${scenario.assertions.join(',')}|${steps}`;
}

function stableValueKey(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

// --- Eventually-resolution driver ---

/**
 * Detect pending 'eventually' assertions and try to drive their property to true.
 * Strategy:
 *   1. Parse the check function to find what signals need what values
 *   2. Drive signals directly based on parsed expression
 *   3. Fall back to observational: try each boolean value for each upstream signal
 */
async function resolveEventuallyAssertions(
  graph: CircuitGraph,
  assertions: Array<{ id: string; name: string; kind: string; checkFn: () => boolean; deps: string[] }>,
  rootNodes: Array<NonNullable<ReturnType<CircuitGraph['getNode']>>>,
  flush: () => void | Promise<void>,
): Promise<void> {
  const eventuallyAssertions = assertions.filter(a => a.kind === 'after');

  for (const assertion of eventuallyAssertions) {
    // Check if the assertion is pending (armed but not yet satisfied)
    // An 'after' assertion returns true vacuously when not armed, and true when still waiting.
    // We detect pending state by checking if the check passes AND if there was a recent armed event.
    if (assertion.checkFn()) {
      // For assertAfter, retrieve the original user checkFn from node metadata for parsing
      // (the checkFn on the assertion is the wrapper, not the user's original property check)
      const userCheckFn = graph.getAssertionUserCheckFn(assertion.id) || assertion.checkFn;

      // Try to parse the check function and drive resolution
      const parsed = parseCheckFn(userCheckFn);

      if (parsed) {
        // Strategy 1: Drive signals based on parsed expression
        await driveFromParsed(graph, parsed, flush);
      } else {
        // Strategy 2: Observational — try boolean values for each upstream root
        await driveObservational(graph, rootNodes, assertion.checkFn, flush);
      }
    }
  }
}

interface ParsedCheck {
  negations: string[];   // signals that should be false: !signal.val
  affirmatives: string[]; // signals that should be truthy: signal.val
  disjuncts: string[][];  // groups of signals in OR: signal1.val || signal2.val
}

/**
 * Parse a check function's toString() to determine what signal values would satisfy it.
 */
function parseCheckFn(fn: () => boolean): ParsedCheck | null {
  try {
    const source = fn.toString();

    const negations: string[] = [];
    const affirmatives: string[] = [];
    const disjuncts: string[][] = [];

    // Match !signal.val patterns (negation — signal should be false to satisfy)
    for (const m of source.matchAll(/!(\w+)\.val\b/g)) {
      negations.push(m[1]);
    }

    // Match signal.val || signal.val patterns (disjunction)
    const disjunctMatch = source.match(/(\w+\.val)\s*\|\|\s*(\w+\.val)/g);
    if (disjunctMatch) {
      for (const d of disjunctMatch) {
        const signals = [...d.matchAll(/(\w+)\.val/g)].map(m => m[1]);
        disjuncts.push(signals);
      }
    }

    // Match standalone signal.val (affirmative, not preceded by !)
    for (const m of source.matchAll(/(?<![!\w])(\w+)\.val\b/g)) {
      if (!negations.includes(m[1])) {
        affirmatives.push(m[1]);
      }
    }

    if (negations.length === 0 && affirmatives.length === 0 && disjuncts.length === 0) {
      return null;
    }

    return { negations, affirmatives, disjuncts };
  } catch {
    return null;
  }
}

/**
 * Drive signals to values suggested by parsed expression analysis.
 */
async function driveFromParsed(
  graph: CircuitGraph,
  parsed: ParsedCheck,
  flush: () => void | Promise<void>,
): Promise<void> {
  const nodes = graph.getNodes();
  const nodeByName = new Map(nodes.map(n => [n.name, n]));

  graph.openTick();

  // Drive negations: set signal to false
  for (const name of parsed.negations) {
    const node = nodeByName.get(name);
    if (node?.setValue) {
      graph.driveNodeValue(node.id, false);
    }
  }

  // Drive affirmatives: set signal to true
  for (const name of parsed.affirmatives) {
    const node = nodeByName.get(name);
    if (node?.setValue) {
      graph.driveNodeValue(node.id, true);
    }
  }

  // Drive disjuncts: try each signal independently (set first one to true)
  for (const group of parsed.disjuncts) {
    for (const name of group) {
      const node = nodeByName.get(name);
      if (node?.setValue) {
        graph.driveNodeValue(node.id, true);
        break; // only need one disjunct to be true
      }
    }
  }

  await flush();
  graph.checkAssertions();
  graph.closeTick();
}

/**
 * Observational fallback: try setting each upstream signal to each boolean value
 * until the property is satisfied.
 */
async function driveObservational(
  graph: CircuitGraph,
  rootNodes: Array<NonNullable<ReturnType<CircuitGraph['getNode']>>>,
  checkFn: () => boolean,
  flush: () => void | Promise<void>,
): Promise<void> {
  for (const node of rootNodes) {
    if (!node.setValue) continue;

    for (const val of [true, false]) {
      graph.openTick();
      graph.driveNodeValue(node.id, val);
      await flush();
      graph.checkAssertions();
      graph.closeTick();

      // Check if the assertion is now satisfied (checkFn returns true means either
      // not armed or property satisfied)
      if (checkFn()) return;
    }
  }
}

async function sequenceExploration(
  graph: CircuitGraph,
  assertions: AssertionInfo[],
  flush: () => void | Promise<void>,
  restoreBaseline: () => Promise<void>,
  remainingBudget: number,
  scenarioCounter: number,
): Promise<ExplorationPhaseResult> {
  const violations: Violation[] = [];
  const scenarios: ScenarioTrace[] = [];
  let steps = 0;
  let stoppedByBudget = false;

  for (const assertion of assertions.filter(a => a.kind === 'after')) {
    if (steps >= remainingBudget) {
      stoppedByBudget = true;
      break;
    }

    const trigger = firstDriveableNode(graph, assertion.metadata?.triggerDeps ?? assertion.deps);
    if (!trigger) continue;
    await restoreBaseline();

    const edge = assertion.metadata?.edge
      ?? (assertion.name.includes('negedge') ? 'negedge' : 'posedge');
    const preEdge = edge === 'negedge' ? true : false;
    const postEdge = edge === 'negedge' ? false : true;
    const sequence: Array<{ signal: string; value: any }> = [];
    const eventMarker = markEvents(graph);

    graph.openTick();
    graph.driveNodeValue(trigger.id, preEdge);
    sequence.push({ signal: trigger.name, value: preEdge });
    await flush();
    graph.closeTick();
    steps++;
    if (steps >= remainingBudget) {
      stoppedByBudget = true;
      scenarios.push(sequenceScenario(graph, assertion, `scenario-${scenarioCounter++}`, sequence, [], eventMarker));
      break;
    }

    graph.openTick();
    graph.driveNodeValue(trigger.id, postEdge);
    sequence.push({ signal: trigger.name, value: postEdge });
    await flush();
    const found = graph.checkAssertions();
    graph.closeTick();
    steps++;

    const matching = found.filter(violation => violation.name === assertion.name);
    scenarios.push(sequenceScenario(graph, assertion, `scenario-${scenarioCounter++}`, sequence, matching, eventMarker));
    violations.push(...violationsFromScenario(graph, matching, sequence));

    const propertyNodes = temporalPropertyNodes(graph, assertion);
    for (const propNode of propertyNodes) {
      if (steps >= remainingBudget) {
        stoppedByBudget = true;
        break;
      }
      const domain = domainForDriveNode(graph, assertion, assertions, propNode);
      for (const value of domain) {
        if (steps >= remainingBudget) {
          stoppedByBudget = true;
          break;
        }
        const propMarker = markEvents(graph);
        const extSequence = [...sequence, { signal: propNode.name, value }];

        graph.openTick();
        graph.driveNodeValue(propNode.id, value);
        await flush();
        const propFound = graph.checkAssertions();
        graph.closeTick();
        steps++;

        const propMatching = propFound.filter(violation => violation.name === assertion.name);
        scenarios.push(sequenceScenario(graph, assertion, `scenario-${scenarioCounter++}`, extSequence, propMatching, propMarker));
        violations.push(...violationsFromScenario(graph, propMatching, extSequence));
      }
    }
  }

  return { violations, scenarios, steps, stoppedByBudget, nextScenarioCounter: scenarioCounter };
}

async function operationOutcomeExploration(
  graph: CircuitGraph,
  checkedAssertionNames: string[],
  flush: () => void | Promise<void>,
  restoreBaseline: () => Promise<void>,
  remainingBudget: number,
  scenarioCounter: number,
): Promise<ExplorationPhaseResult> {
  const violations: Violation[] = [];
  const scenarios: ScenarioTrace[] = [];
  let steps = 0;
  let stoppedByBudget = false;

  for (const model of graph.getOperationModels()) {
    for (const outcome of model.outcomes) {
      if (outcome === 'pending') continue;
      if (steps + 2 > remainingBudget) {
        stoppedByBudget = true;
        break;
      }

      await restoreBaseline();
      const eventMarker = markEvents(graph);
      const sequence = [{ signal: `operation:${model.name}`, value: outcome }];

      graph.openTick();
      const operationId = graph.beginOperation(model.name, {
        ...model.metadata,
        outcomes: model.outcomes,
        triggerDeps: model.triggerDeps,
        outputDeps: model.outputDeps,
        modelId: model.id,
      });
      await flush();
      graph.closeTick();
      steps++;

      graph.openTick();
      graph.setAsyncContext(true);
      try {
        graph.completeOperationOutcome(operationId, outcome, operationPayloadFor(outcome));
        await graph.withOperation(operationId, async () => {
          await model.handleOutcome?.(outcome, { graph, operationId, model });
        });
      } finally {
        graph.setAsyncContext(false);
      }
      await flush();
      const found = graph.checkAssertions();
      graph.closeTick();
      steps++;

      const scenario: ScenarioTrace = {
        id: `scenario-${scenarioCounter++}`,
        kind: 'operation-outcome',
        tick: graph.currentTick,
        steps: sequence,
        assertions: checkedAssertionNames,
        violations: found.map(violation => violation.name),
        observations: observationsSince(graph, eventMarker),
      };
      scenarios.push(scenario);
      violations.push(...found.map(violation => ({
        assertionName: violation.name,
        tick: graph.currentTick,
        signalValues: { [`operation:${model.name}`]: outcome },
        sequence,
      })));
    }
    if (stoppedByBudget) break;
  }

  return { violations, scenarios, steps, stoppedByBudget, nextScenarioCounter: scenarioCounter };
}

function operationPayloadFor(outcome: OperationStatus): any {
  if (outcome === 'resolved') return { ok: true };
  if (outcome === 'rejected') return { error: 'modeled error' };
  if (outcome === 'aborted') return { reason: 'modeled abort' };
  if (outcome === 'stale') return { newerId: 'modeled-newer-operation' };
  return undefined;
}

function sequenceScenario(
  graph: CircuitGraph,
  assertion: AssertionInfo,
  id: string,
  sequence: Array<{ signal: string; value: any }>,
  found: ReturnType<CircuitGraph['checkAssertions']>,
  eventMarker: Set<GraphEvent>,
): ScenarioTrace {
  return {
    id,
    kind: 'sequence',
    tick: graph.currentTick,
    steps: sequence,
    assertions: [assertion.name],
    violations: found.map(violation => violation.name),
    observations: observationsSince(graph, eventMarker),
  };
}

function temporalPropertyNodes(graph: CircuitGraph, assertion: AssertionInfo): DriveNode[] {
  const ids = new Set<string>([
    ...(assertion.metadata?.checkDeps ?? []),
    ...assertion.deps.slice(1),
  ]);

  const userCheckFn = graph.getAssertionUserCheckFn(assertion.id) ?? assertion.checkFn;
  const parsed = parseComputeFn(userCheckFn);
  if (parsed) {
    const names = new Set(parsed.signals);
    for (const node of graph.getNodes()) {
      if (names.has(node.name) || names.has(node.stablePath) || names.has(node.id)) {
        ids.add(node.id);
      }
    }
  }

  for (const id of [...ids]) {
    for (const upstream of backwardCone(graph, id)) ids.add(upstream);
  }

  return [...ids]
    .map(id => graph.getNode(id))
    .filter((node): node is DriveNode => node != null && node.type === 'signal' && node.setValue != null);
}

async function coverageDirectedPass(
  graph: CircuitGraph,
  checkedAssertionNames: string[],
  assertions: AssertionInfo[],
  flush: () => void | Promise<void>,
  restoreBaseline: () => Promise<void>,
  remainingBudget: number,
  scenarioCounter: number,
): Promise<ExplorationPhaseResult> {
  const violations: Violation[] = [];
  const scenarios: ScenarioTrace[] = [];
  let steps = 0;
  let stoppedByBudget = false;

  while (steps < remainingBudget) {
    const report = coverage.getReport();
    const uncoveredToggle = report.toggle.find(entry => !entry.seenTrue || !entry.seenFalse);
    if (uncoveredToggle) {
      const node = graph.getNode(uncoveredToggle.signalId);
      if (node?.setValue) {
        const targetValue = !uncoveredToggle.seenTrue;
        const domain = coverageDomainForNode(assertions, node) ?? metadataStateDomain(node);
        if (domain && !domain.some(value => Object.is(value, targetValue))) break;
        const result = await runCoverageDirectedAssignment(
          graph,
          checkedAssertionNames,
          [{ node, value: targetValue }],
          flush,
          restoreBaseline,
          `scenario-${scenarioCounter++}`,
        );
        scenarios.push(result.scenario);
        violations.push(...result.violations);
        steps++;
        continue;
      }
    }

    const transitionGap = report.gaps.find(gap => gap.kind === 'transition' && gap.missing.length > 0);
    if (transitionGap && remainingBudget - steps < 2) {
      stoppedByBudget = true;
      break;
    }

    if (transitionGap) {
      const node = graph.getNode(transitionGap.id);
      const [from, to] = transitionGap.missing[0]?.split('->') ?? [];
      if (node?.setValue && from !== undefined && to !== undefined) {
        const result = await runCoverageDirectedAssignment(
          graph,
          checkedAssertionNames,
          [
            { node, value: parseTransitionValue(from, node.getValue?.()) },
            { node, value: parseTransitionValue(to, node.getValue?.()) },
          ],
          flush,
          restoreBaseline,
          `scenario-${scenarioCounter++}`,
        );
        scenarios.push(result.scenario);
        violations.push(...result.violations);
        steps += 2;
        continue;
      }
    }

    break;
  }

  return { violations, scenarios, steps, stoppedByBudget, nextScenarioCounter: scenarioCounter };
}

async function runCoverageDirectedAssignment(
  graph: CircuitGraph,
  checkedAssertionNames: string[],
  assignment: DriveAssignment,
  flush: () => void | Promise<void>,
  restoreBaseline: () => Promise<void>,
  id: string,
): Promise<{ violations: Violation[]; scenario: ScenarioTrace }> {
  await restoreBaseline();
  const eventMarker = markEvents(graph);
  const sequence: Array<{ signal: string; value: any }> = [];

  for (const { node, value } of assignment) {
    graph.openTick();
    graph.driveNodeValue(node.id, value);
    sequence.push({ signal: node.name, value });
    await flush();
    graph.closeTick();
  }

  graph.openTick();
  const found = graph.checkAssertions();
  graph.closeTick();
  const scenario: ScenarioTrace = {
    id,
    kind: 'coverage-directed',
    tick: graph.currentTick,
    steps: sequence,
    assertions: checkedAssertionNames,
    violations: found.map(violation => violation.name),
    observations: observationsSince(graph, eventMarker),
  };

  return {
    scenario,
    violations: violationsFromScenario(graph, found, sequence),
  };
}

function parseTransitionValue(value: string, current: unknown): unknown {
  if (typeof current === 'boolean') return value === 'true';
  if (typeof current === 'number') {
    const numeric = Number(value);
    return Number.isNaN(numeric) ? value : numeric;
  }
  if (value === 'null') return null;
  return value;
}

function violationsFromScenario(
  graph: CircuitGraph,
  found: ReturnType<CircuitGraph['checkAssertions']>,
  sequence: Array<{ signal: string; value: any }>,
): Violation[] {
  const signalValues = Object.fromEntries(sequence.map(step => [step.signal, step.value]));
  return found.map(violation => ({
    assertionName: violation.name,
    tick: graph.currentTick,
    signalValues,
    sequence,
  }));
}

// --- Adversarial pass ---

interface AdversarialResult {
  violations: Violation[];
  scenarios: ScenarioTrace[];
  steps: number;
  stoppedByBudget: boolean;
}

interface ExplorationPhaseResult extends AdversarialResult {
  nextScenarioCounter: number;
}

interface AssertionInfo {
  id: string;
  name: string;
  kind: string;
  checkFn: () => boolean;
  deps: string[];
  metadata?: AssertionMetadata;
}

type DriveNode = NonNullable<ReturnType<CircuitGraph['getNode']>>;
type DriveAssignment = Array<{ node: DriveNode; value: any }>;

/**
 * Adversarial pass: for each assertion, try to break it by driving inputs toward violation.
 *
 * - For assertAlways: parse check to find negation, drive toward it
 * - For assertAfter: trigger the edge, then try to prevent property satisfaction
 */
async function adversarialPass(
  graph: CircuitGraph,
  assertions: AssertionInfo[],
  flush: () => void | Promise<void>,
  restoreBaseline: () => Promise<void>,
  remainingBudget: number,
): Promise<AdversarialResult> {
  const violations: Violation[] = [];
  const scenarios: ScenarioTrace[] = [];
  let steps = 0;
  const nodes = graph.getNodes();
  const nodeByName = new Map(nodes.map(n => [n.name, n]));
  let scenarioCounter = 0;
  let stoppedByBudget = false;

  for (const assertion of assertions) {
    if (steps >= remainingBudget) {
      stoppedByBudget = true;
      break;
    }

    if (assertion.kind === 'after') {
      const result = await runTemporalAdversarialScenario(
        graph,
        assertion,
        assertions,
        flush,
        restoreBaseline,
        `adversarial-${scenarioCounter++}`,
        remainingBudget - steps,
      );
      violations.push(...result.violations);
      scenarios.push(...result.scenarios);
      steps += result.steps;
      stoppedByBudget = stoppedByBudget || result.stoppedByBudget;
      continue;
    }

    const metadataCombos = metadataDriveAssignments(graph, assertion, assertions, remainingBudget - steps);
    if (metadataCombos.length > 0) {
      let metadataFoundViolation = false;
      for (const combo of metadataCombos) {
        if (steps >= remainingBudget) {
          stoppedByBudget = true;
          break;
        }
        const result = await runAdversarialAssignment(
          graph,
          assertion,
          combo,
          flush,
          restoreBaseline,
          `adversarial-${scenarioCounter++}`,
        );
        violations.push(...result.violations);
        scenarios.push(result.scenario);
        steps++;
        if (result.violations.some(violation => violation.assertionName === assertion.name)) {
          metadataFoundViolation = true;
          break;
        }
      }
      if (metadataFoundViolation || steps >= remainingBudget) continue;
    }

    if (assertion.kind === 'always' || assertion.kind === 'never') {
      // Parse the check function to find what would violate it
      // Use originalCheckFn if available (assertNever wraps the user's fn)
      const fnToParse = graph.getAssertionUserCheckFn(assertion.id) ?? assertion.checkFn;
      const parsed = parseComputeFn(fnToParse);
      if (!parsed) continue;

      // Find signals in the assertion's backward cone
      const coneIds = backwardCone(graph, assertion.id);
      const coneNodes = coneIds
        .map(id => graph.getNode(id))
        .filter((n): n is NonNullable<typeof n> => n != null && n.setValue != null);

      // Try to drive toward violation using parsed expression structure
      const source = fnToParse.toString();
      const targetValues = new Map<string, any>();

      // Build a map of signal comparisons from the parsed result
      // e.g. error !== null → drive error to a non-null value
      const comparisonValues = new Map<string, any>();
      for (const comp of parsed.comparisons) {
        if ((comp.op === '!==' || comp.op === '!=') && comp.value === 'null') {
          // Signal !== null: to make this true, drive to a non-null value
          const node = nodeByName.get(comp.signal);
          const currentVal = node?.getValue?.();
          comparisonValues.set(comp.signal,
            typeof currentVal === 'string' || currentVal === null ? 'error' :
            typeof currentVal === 'number' ? 1 : true
          );
        } else if ((comp.op === '===' || comp.op === '==') && comp.value === 'null') {
          // Signal === null: to make this true, drive to null
          comparisonValues.set(comp.signal, null);
        }
      }

      // For !(a && b) style: try to make inner expression true (to violate negation)
      const negAndMatch = source.match(/!\s*\(([^)]+)\)/);
      if (negAndMatch) {
        const inner = negAndMatch[1];
        // Extract signal.val references first
        for (const m of inner.matchAll(/(\w+)\.val\b/g)) {
          const name = m[1];
          const node = nodeByName.get(name);
          if (node) {
            const drive = driveValueForAssertion(assertion.metadata, assertions, node, comparisonValues.get(name) ?? true);
            if (drive.driveable) targetValues.set(name, drive.value);
          }
        }
        // If no .val refs found, try plain identifiers (headless test mode)
        if (targetValues.size === 0) {
          for (const m of inner.matchAll(/\b(\w+)\b/g)) {
            const name = m[1];
            const node = nodeByName.get(name);
            if (node) {
              const drive = driveValueForAssertion(assertion.metadata, assertions, node, comparisonValues.get(name) ?? true);
              if (drive.driveable) targetValues.set(name, drive.value);
            }
          }
        }
      }

      // Fallback: use parsed signals with comparison-aware values
      if (targetValues.size === 0) {
        for (const sigName of parsed.signals) {
          const node = nodeByName.get(sigName);
          if (node) {
            const drive = driveValueForAssertion(assertion.metadata, assertions, node, comparisonValues.get(sigName) ?? true);
            if (drive.driveable) targetValues.set(sigName, drive.value);
          }
        }
      }

      // Last resort: try setting all signals in cone to true
      if (targetValues.size === 0) {
        for (const node of coneNodes) {
          const drive = driveValueForAssertion(assertion.metadata, assertions, node, comparisonValues.get(node.name) ?? true);
          if (drive.driveable) targetValues.set(node.name, drive.value);
        }
      }

      if (targetValues.size > 0) {
        const assignment = [...targetValues.entries()]
          .map(([name, value]) => {
            const node = nodeByName.get(name);
            return node ? { node, value } : null;
          })
          .filter((entry): entry is { node: DriveNode; value: any } => entry != null);
        const result = await runAdversarialAssignment(
          graph,
          assertion,
          assignment,
          flush,
          restoreBaseline,
          `adversarial-${scenarioCounter++}`,
        );
        violations.push(...result.violations);
        scenarios.push(result.scenario);
        steps++;
      }
    }
  }

  return { violations, scenarios, steps, stoppedByBudget };
}

async function runAdversarialAssignment(
  graph: CircuitGraph,
  assertion: AssertionInfo,
  assignment: DriveAssignment,
  flush: () => void | Promise<void>,
  restoreBaseline: () => Promise<void>,
  id: string,
): Promise<{ violations: Violation[]; scenario: ScenarioTrace }> {
  await restoreBaseline();
  const eventMarker = markEvents(graph);
  graph.openTick();
  for (const { node, value } of assignment) {
    if (node.setValue) graph.driveNodeValue(node.id, value);
  }
  await flush();
  const found = graph.checkAssertions();
  graph.closeTick();

  const sequence = assignment.map(({ node, value }) => ({ signal: node.name, value }));
  const signalValues = Object.fromEntries(sequence.map(step => [step.signal, step.value]));
  const scenario: ScenarioTrace = {
    id,
    kind: 'adversarial',
    tick: graph.currentTick,
    steps: sequence,
    assertions: [assertion.name],
    violations: found.map(violation => violation.name),
    observations: observationsSince(graph, eventMarker),
  };

  return {
    scenario,
    violations: found.map(violation => ({
      assertionName: violation.name,
      tick: graph.currentTick,
      signalValues,
      sequence,
    })),
  };
}

function metadataDriveAssignments(
  graph: CircuitGraph,
  assertion: AssertionInfo,
  assertions: AssertionInfo[],
  budget: number,
): DriveAssignment[] {
  const nodes = driveNodesForAssertion(graph, assertion);
  const driveable = nodes
    .map(node => {
      const domain = domainForDriveNode(graph, assertion, assertions, node);
      return domain.length > 0 ? { node, domain } : null;
    })
    .filter((entry): entry is { node: DriveNode; domain: any[] } => entry != null);

  if (driveable.length === 0) return [];

  const limit = Math.max(1, Math.min(budget, 64));
  const combos: DriveAssignment[] = [];
  const total = driveable.reduce((count, entry) => count * entry.domain.length, 1);
  for (let i = 0; i < total && combos.length < limit; i++) {
    let cursor = i;
    const combo: DriveAssignment = [];
    for (const entry of driveable) {
      const value = entry.domain[cursor % entry.domain.length];
      cursor = Math.floor(cursor / entry.domain.length);
      combo.push({ node: entry.node, value });
    }
    combos.push(combo);
  }
  return combos;
}

function driveNodesForAssertion(graph: CircuitGraph, assertion: AssertionInfo): DriveNode[] {
  const ids = new Set<string>(backwardCone(graph, assertion.id));
  for (const dep of [...(assertion.metadata?.checkDeps ?? []), ...(assertion.metadata?.triggerDeps ?? [])]) {
    ids.add(dep);
    for (const upstream of backwardCone(graph, dep)) ids.add(upstream);
  }

  return [...ids]
    .map(id => graph.getNode(id))
    .filter((node): node is DriveNode => node != null && node.type === 'signal' && node.setValue != null);
}

function domainForDriveNode(
  graph: CircuitGraph,
  assertion: AssertionInfo,
  assertions: AssertionInfo[],
  node: DriveNode,
): any[] {
  const declared = domainForNode(assertion.metadata?.domains, node)
    ?? metadataStateDomain(node)
    ?? coverageDomainForNode(assertions, node);
  const inferred = inferBoundariesForNode(node, assertions, graph);
  const reachableInferred = constrainToDeclaredDomain(inferred, declared);
  if (reachableInferred.length > 0) return reachableInferred;
  if (declared && declared.length > 0) return uniqueValues(declared);

  const current = node.getValue?.();
  if (typeof current === 'boolean') return [true, false];
  if (isOpaqueRootValue(current)) return [];
  if (typeof current === 'string') return uniqueValues([current, 'value']);
  if (typeof current === 'number') return uniqueValues([current, 0, 1]);
  if (current === null) return [null, 'value'];
  return uniqueValues([current, true, false]);
}

function uniqueValues(values: any[]): any[] {
  const result: any[] = [];
  for (const value of values) {
    if (!result.some(existing => Object.is(existing, value))) result.push(value);
  }
  return result;
}

async function runTemporalAdversarialScenario(
  graph: CircuitGraph,
  assertion: AssertionInfo,
  assertions: AssertionInfo[],
  flush: () => void | Promise<void>,
  restoreBaseline: () => Promise<void>,
  id: string,
  budget: number,
): Promise<AdversarialResult> {
  const trigger = firstDriveableNode(graph, assertion.metadata?.triggerDeps ?? assertion.deps);
  if (!trigger) return { violations: [], scenarios: [], steps: 0, stoppedByBudget: false };
  if (budget <= 0) return { violations: [], scenarios: [], steps: 0, stoppedByBudget: true };
  await restoreBaseline();

  const checkNodes = (assertion.metadata?.checkDeps ?? [])
    .flatMap(dep => {
      const direct = graph.getNode(dep);
      const upstream = backwardCone(graph, dep).map(id => graph.getNode(id));
      return [direct, ...upstream];
    })
    .filter((node): node is DriveNode => node != null && node.type === 'signal' && node.setValue != null);

  const checkAssignment = checkNodes
    .map(node => {
      const domain = domainForDriveNode(graph, assertion, assertions, node);
      if (domain.length === 0) return null;
      const current = node.getValue?.();
      const value = domain.find(candidate => !Object.is(candidate, current)) ?? domain[0];
      return { node, value };
    })
    .filter((entry): entry is { node: DriveNode; value: any } => entry != null);

  const sequence: Array<{ signal: string; value: any }> = [];
  const eventMarker = markEvents(graph);
  let steps = 0;
  let found: ReturnType<CircuitGraph['checkAssertions']> = [];

  graph.openTick();
  graph.driveNodeValue(trigger.id, false);
  sequence.push({ signal: trigger.name, value: false });
  for (const { node, value } of checkAssignment) {
    graph.driveNodeValue(node.id, value);
    sequence.push({ signal: node.name, value });
  }
  await flush();
  graph.checkAssertions();
  graph.closeTick();
  steps++;
  if (steps >= budget) {
    return temporalResult(graph, id, assertion, sequence, found, eventMarker, steps, true);
  }

  graph.openTick();
  graph.driveNodeValue(trigger.id, true);
  sequence.push({ signal: trigger.name, value: true });
  for (const { node, value } of checkAssignment) {
    graph.driveNodeValue(node.id, value);
  }
  await flush();
  found = graph.checkAssertions();
  graph.closeTick();
  steps++;

  for (let i = 0; found.length === 0 && i < 3 && steps < budget; i++) {
    graph.openTick();
    for (const { node, value } of checkAssignment) {
      graph.driveNodeValue(node.id, value);
    }
    await flush();
    found = graph.checkAssertions();
    graph.closeTick();
    steps++;
  }

  return temporalResult(graph, id, assertion, sequence, found, eventMarker, steps, steps >= budget);
}

function firstDriveableNode(graph: CircuitGraph, ids: string[]): DriveNode | undefined {
  for (const id of ids) {
    const node = graph.getNode(id);
    if (node?.type === 'signal' && node.setValue) return node;
  }
  return undefined;
}

function temporalResult(
  graph: CircuitGraph,
  id: string,
  assertion: AssertionInfo,
  sequence: Array<{ signal: string; value: any }>,
  found: ReturnType<CircuitGraph['checkAssertions']>,
  eventMarker: Set<GraphEvent>,
  steps: number,
  stoppedByBudget: boolean,
): AdversarialResult {
  const signalValues = Object.fromEntries(sequence.map(step => [step.signal, step.value]));
  const matching = found.filter(violation => violation.name === assertion.name);
  const scenario: ScenarioTrace = {
    id,
    kind: 'adversarial',
    tick: graph.currentTick,
    steps: sequence,
    assertions: [assertion.name],
    violations: matching.map(violation => violation.name),
    observations: observationsSince(graph, eventMarker),
  };
  return {
    scenarios: [scenario],
    steps,
    stoppedByBudget,
    violations: matching.map(violation => ({
      assertionName: violation.name,
      tick: graph.currentTick,
      signalValues,
      sequence,
    })),
  };
}
