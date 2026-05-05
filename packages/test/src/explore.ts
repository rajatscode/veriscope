// explore.ts — Main explore() function: backward-cone-driven state exploration

import { coverage, type CircuitGraph, type CoverageReport } from '@veriscope/graph';
import { backwardCone } from './backward-solve.js';
import { parseComputeFn } from './fn-parser.js';
import type { ExploreOptions, ExploreResult, Violation } from './types.js';

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

  // Save original signal values so we can restore after exploration
  const signalNodes = graph.getNodes().filter(n => n.type === 'signal' && n.getValue);
  const savedValues = new Map<string, any>();
  for (const node of signalNodes) {
    savedValues.set(node.id, node.getValue!());
  }

  try {
    // 1. Discover assertions
    const assertions = graph.getAssertions();

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

      const nonBoolRoots = rootNodes.filter(n => {
        if (!n.getValue) return false;
        const v = n.getValue();
        return typeof v !== 'boolean';
      });

      // 3b. Detect patterns in the assertion to determine non-boolean values to try
      const userCheckFn = graph.getAssertionUserCheckFn(assertion.id) ?? assertion.checkFn;
      const fnSource = userCheckFn.toString();
      const nonNullSignals = new Set<string>();
      const nullableSignals = new Set<string>();

      for (const m of fnSource.matchAll(/(\w+)\.val\s*!==\s*null\b/g)) {
        nonNullSignals.add(m[1]);
      }
      for (const m of fnSource.matchAll(/(\w+)\.val\s*===\s*null\b/g)) {
        nullableSignals.add(m[1]);
      }

      const nonBoolDomains = new Map<string, any[]>();
      for (const node of nonBoolRoots) {
        const declaredDomain = domainForNode(assertion.metadata?.domains, node);
        if (declaredDomain && declaredDomain.length > 0) {
          nonBoolDomains.set(node.id, declaredDomain);
          continue;
        }

        const currentVal = node.getValue?.();
        if (nonNullSignals.has(node.name)) {
          nonBoolDomains.set(node.id, [
            typeof currentVal === 'string' ? 'error' : 1,
            typeof currentVal === 'string' ? 'test' : 42,
          ]);
        } else if (nullableSignals.has(node.name)) {
          nonBoolDomains.set(node.id, [null]);
        } else {
          nonBoolDomains.set(node.id, [
            currentVal,
            typeof currentVal === 'string' ? 'value' : 1,
          ]);
        }
      }

      const nonBoolComboCount = nonBoolRoots.reduce(
        (total, node) => total * Math.max(nonBoolDomains.get(node.id)?.length ?? 0, 1),
        1,
      );
      const totalCombos = Math.max(1, (1 << boolRoots.length) * nonBoolComboCount);

      if ((boolRoots.length > 0 || nonBoolRoots.length > 0) && rootNodes.length <= 15) {
        // 4. Enumerate combinations of booleans × non-boolean value variants
        for (let i = 0; i < totalCombos && steps < budget; i++) {
          const boolIdx = i % (1 << boolRoots.length);
          const nonBoolIdx = Math.floor(i / (1 << boolRoots.length));
          const boolCombo = boolRoots.map((_, j) => !!(boolIdx & (1 << j)));

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
          scenarios.push({
            id: `scenario-${scenarioCounter++}`,
            kind: 'enumerated',
            tick: graph.currentTick,
            steps: sequence,
            assertions: [assertion.name],
            violations: v.map(violation => violation.name),
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
        graph.openTick();
        await flush();
        const v = graph.checkAssertions();
        graph.closeTick();
        scenarios.push({
          id: `scenario-${scenarioCounter++}`,
          kind: 'current-state',
          tick: graph.currentTick,
          steps: [],
          assertions: [assertion.name],
          violations: v.map(violation => violation.name),
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

    // 6. Adversarial pass — try to break each assertion
    if (steps < budget) {
      const advViolations = await adversarialPass(graph, assertions, flush, budget - steps);
      violations.push(...advViolations.violations);
      steps += advViolations.steps;
    }

    // 7. Coverage completion pass — drive untoggled booleans and FSM states
    if (steps < budget) {
      for (const node of signalNodes) {
        if (steps >= budget) break;
        if (!node.setValue) continue;

        const currentVal = node.getValue?.();

        if (typeof currentVal === 'boolean') {
          // Toggle to both true and false
          for (const val of [true, false]) {
            graph.openTick();
            graph.driveNodeValue(node.id, val);
            await flush();
            graph.closeTick();
            scenarios.push({
              id: `scenario-${scenarioCounter++}`,
              kind: 'coverage-completion',
              tick: graph.currentTick,
              steps: [{ signal: node.name, value: val }],
              assertions: assertions.map(assertion => assertion.name),
              violations: [],
            });
            steps++;
          }
        }

        // FSM signals with known states — drive through each state
        if (node.metadata?.states && Array.isArray(node.metadata.states)) {
          for (const state of node.metadata.states) {
            if (steps >= budget) break;
            graph.openTick();
            graph.driveNodeValue(node.id, state);
            await flush();
            graph.closeTick();
            scenarios.push({
              id: `scenario-${scenarioCounter++}`,
              kind: 'coverage-completion',
              tick: graph.currentTick,
              steps: [{ signal: node.name, value: state }],
              assertions: assertions.map(assertion => assertion.name),
              violations: [],
            });
            steps++;
          }
        }
      }
    }

    const report = coverage.getReport();
    return {
      violations,
      coverage: summarizeCoverage(report),
      steps,
      scenarios,
      snapshot: graph.snapshot({ tool: '@veriscope/test/explore', steps }),
    };
  } finally {
    graph.disableCoverage();
    graph.openTick();
    for (const node of signalNodes) {
      if (node.setValue && savedValues.has(node.id)) {
        graph.driveNodeValue(node.id, savedValues.get(node.id));
      }
    }
    graph.closeTick();
    graph.exitTestMode();
  }
}

function domainForNode(domains: Record<string, any[]> | undefined, node: NonNullable<ReturnType<CircuitGraph['getNode']>>): any[] | undefined {
  return domains?.[node.id] ?? domains?.[node.stablePath] ?? domains?.[node.name];
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

// --- Adversarial pass ---

interface AdversarialResult {
  violations: Violation[];
  steps: number;
}

/**
 * Adversarial pass: for each assertion, try to break it by driving inputs toward violation.
 *
 * - For assertAlways: parse check to find negation, drive toward it
 * - For assertAfter: trigger the edge, then try to prevent property satisfaction
 */
async function adversarialPass(
  graph: CircuitGraph,
  assertions: Array<{ id: string; name: string; kind: string; checkFn: () => boolean; deps: string[] }>,
  flush: () => void | Promise<void>,
  remainingBudget: number,
): Promise<AdversarialResult> {
  const violations: Violation[] = [];
  let steps = 0;
  const nodes = graph.getNodes();
  const nodeByName = new Map(nodes.map(n => [n.name, n]));

  for (const assertion of assertions) {
    if (steps >= remainingBudget) break;

    if (assertion.kind === 'always') {
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
          if (nodeByName.has(name)) {
            targetValues.set(name, comparisonValues.get(name) ?? true);
          }
        }
        // If no .val refs found, try plain identifiers (headless test mode)
        if (targetValues.size === 0) {
          for (const m of inner.matchAll(/\b(\w+)\b/g)) {
            const name = m[1];
            if (nodeByName.has(name)) {
              targetValues.set(name, comparisonValues.get(name) ?? true);
            }
          }
        }
      }

      // Fallback: use parsed signals with comparison-aware values
      if (targetValues.size === 0) {
        for (const sigName of parsed.signals) {
          if (nodeByName.has(sigName)) {
            targetValues.set(sigName, comparisonValues.get(sigName) ?? true);
          }
        }
      }

      // Last resort: try setting all signals in cone to true
      if (targetValues.size === 0) {
        for (const node of coneNodes) {
          targetValues.set(node.name, comparisonValues.get(node.name) ?? true);
        }
      }

      if (targetValues.size > 0) {
        graph.openTick();
        for (const [name, value] of targetValues) {
          const node = nodeByName.get(name);
          if (node?.setValue) {
            graph.driveNodeValue(node.id, value);
          }
        }
        await flush();

        const v = graph.checkAssertions();
        graph.closeTick();
        steps++;

        if (v.length > 0) {
          for (const violation of v) {
            violations.push({
              assertionName: violation.name,
              tick: graph.currentTick,
              signalValues: Object.fromEntries(targetValues),
              sequence: [...targetValues.entries()].map(([signal, value]) => ({
                signal,
                value,
              })),
            });
          }
        }
      }
    }
    // Skip 'after' assertions — they depend on trigger→property sequences that
    // explore() can't simulate correctly at the graph level. Only 'always' and
    // 'never' assertions are testable via combinational state enumeration.
  }

  return { violations, steps };
}
