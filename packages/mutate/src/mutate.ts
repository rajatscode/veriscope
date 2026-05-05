// mutate.ts — Main mutation testing function

import type { CircuitGraph } from '@veriscope/graph';
import { runAutotest } from '@veriscope/test';
import type { AutotestResult } from '@veriscope/test';
import { generateMutations } from './operators.js';
import type { MutateOptions, MutateProgress, MutateResult, Mutation, SkippedMutation, UnobservedMutation } from './types.js';

const DEFAULT_SCORING_OPERATORS = new Set(['negate', 'constant-fold', 'invert-comparison']);

/**
 * Run mutation testing on a reactive graph.
 *
 * @param factory Function that creates a fresh CircuitGraph for each mutation run
 * @param options Configuration options
 * @returns Mutation testing results including kill rate
 */
export async function mutate(
  factory: () => CircuitGraph,
  options: MutateOptions = {},
): Promise<MutateResult> {
  const budgetPerMutation = options.budget ?? 500;

  // Get mutation list from a reference graph
  const refGraph = factory();
  const candidates = generateMutations(refGraph);
  const { selected: mutations, skipped, unobserved } = selectMutations(refGraph, candidates, options);
  const baseline = await runAutotest(refGraph, {
    budget: budgetPerMutation,
    name: 'mutation-baseline',
  });
  const canClassifyEquivalent = baseline.status === 'passed';
  const baselineSignature = behaviorSignature(baseline);

  const survived: MutateResult['survived'] = [];
  const killedMutations: MutateResult['killedMutations'] = [];
  const invalid: MutateResult['invalid'] = [];
  const equivalent: MutateResult['equivalent'] = [];
  let killed = 0;
  let autotestRuns = 1;
  let autotestSteps = baseline.steps;
  const yieldEvery = Math.max(1, options.yieldEvery ?? 1);

  const emitProgress = async (completed: number, currentMutation?: string) => {
    if (!options.onProgress) return;
    const progress: MutateProgress = {
      total: mutations.length,
      completed,
      generatedMutants: candidates.length,
      skipped: skipped.length,
      unobserved: unobserved.length,
      currentMutation,
      killed,
      survived: survived.length,
      invalid: invalid.length,
      equivalent: equivalent.length,
      budgetPerMutation,
      autotestRuns,
      autotestSteps,
    };
    await options.onProgress(progress);
  };

  await emitProgress(0, mutations[0]?.name);
  await yieldToHost();

  for (let i = 0; i < mutations.length; i++) {
    const mutation = mutations[i];
    // Fresh graph for each mutation
    const graph = factory();

    let undo: (() => void) | undefined;
    try {
      undo = mutation.apply(graph);

      // Autotest the mutated graph using the same scenario/exploration machinery
      // that devtools exposes.
      const result = await runAutotest(graph, {
        budget: budgetPerMutation,
        name: mutation.name,
      });
      autotestRuns++;
      autotestSteps += result.steps;

      if (result.status === 'failed') {
        killed++;
        killedMutations.push({
          mutation: mutation.name,
          description: mutation.description,
          scenarioId: result.scenarios.find(s => s.violations.length > 0)?.id,
          assertionName: result.violations[0]?.assertionName,
        });
      } else if (canClassifyEquivalent && shouldClassifyEquivalent(mutation) && behaviorSignature(result) === baselineSignature) {
        equivalent.push({
          mutation: mutation.name,
          description: mutation.description,
          reason: 'no generated scenario, coverage, or assertion outcome changed relative to the baseline run',
        });
      } else {
        survived.push({ mutation: mutation.name, description: mutation.description });
      }
    } catch (err) {
      invalid.push({
        mutation: mutation.name,
        description: mutation.description,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      undo?.();
    }

    await emitProgress(i + 1, mutations[i + 1]?.name);
    if ((i + 1) % yieldEvery === 0) await yieldToHost();
  }

  const scoredTotal = mutations.length - invalid.length - equivalent.length;
  return {
    total: mutations.length,
    killed,
    killedMutations,
    survived,
    invalid,
    equivalent,
    unobserved,
    score: scoredTotal > 0 ? (killed / scoredTotal) * 100 : 100,
    budgetPerMutation,
    autotestRuns,
    autotestSteps,
    generatedMutants: candidates.length,
    skipped,
  };
}

function selectMutations(
  graph: CircuitGraph,
  candidates: Mutation[],
  options: MutateOptions,
): { selected: Mutation[]; skipped: SkippedMutation[]; unobserved: UnobservedMutation[] } {
  const verificationCone = verificationReachableNodeIds(graph);
  const selected: Mutation[] = [];
  const skipped: SkippedMutation[] = [];
  const unobserved: UnobservedMutation[] = [];
  const explicitOperators = options.operators !== undefined;
  const allowedOperators = Array.isArray(options.operators) ? new Set(options.operators) : null;

  for (const mutation of candidates) {
    const operator = operatorFor(mutation);
    const category = mutation.category ?? categoryFor(operator);

    let reason: string | null = null;
    if (allowedOperators && !allowedOperators.has(operator)) {
      reason = `operator ${operator} was not requested`;
    } else if (!explicitOperators && !DEFAULT_SCORING_OPERATORS.has(operator)) {
      reason = `available in Broad Sweep; excluded from Semantic Score`;
    } else if (!options.includeMetaMutations && category === 'meta') {
      reason = 'meta-mutations are disabled';
    }

    if (reason) {
      skipped.push({
        mutation: mutation.name,
        description: mutation.description,
        reason,
      });
    } else if (category !== 'meta' && !mutationTargetsVerificationSink(mutation, verificationCone)) {
      unobserved.push({
        mutation: mutation.name,
        description: mutation.description,
        reason: 'no path to any declared verification sink',
      });
    } else {
      selected.push(mutation);
    }
  }

  return { selected, skipped, unobserved };
}

function shouldClassifyEquivalent(mutation: Mutation): boolean {
  const category = mutation.category ?? categoryFor(operatorFor(mutation));
  return category === 'structural' || category === 'effect';
}

function behaviorSignature(result: AutotestResult): string {
  const stableId = stableIdMapper(result);
  return stableJson({
    status: result.status,
    assertions: result.assertions.map(assertion => ({
      name: assertion.name,
      kind: assertion.kind,
      status: assertion.status,
      partialCoverage: assertion.partialCoverage,
      exercised: assertion.exercised,
      scenarioCount: assertion.scenarioCount,
      passScenarioCount: assertion.passScenarioCount,
      failScenarioCount: assertion.failScenarioCount,
    })).sort((a, b) => a.name.localeCompare(b.name)),
    coverage: {
      toggle: result.coverage.toggle,
      transitions: result.coverage.transitions,
      cross: result.coverage.cross,
      operations: result.coverage.operations,
      gaps: result.coverage.gaps.map(gap => ({
        kind: gap.kind,
        id: stableId(gap.id),
        missing: [...gap.missing].sort(),
      })).sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`)),
    },
    scenarios: result.scenarios.map(scenario => ({
      kind: scenario.kind,
      steps: scenario.steps.map(step => ({ signal: step.signal, value: stableScenarioValue(step.value) })),
      assertions: [...scenario.assertions].sort(),
      violations: [...scenario.violations].sort(),
      observations: (scenario.observations ?? []).map(obs => ({
        type: obs.type,
        node: obs.node,
        oldValue: stableScenarioValue(obs.oldValue),
        newValue: stableScenarioValue(obs.newValue),
        operationName: obs.operationName,
        status: obs.status,
      })),
    })),
  });
}

function stableIdMapper(result: AutotestResult): (id: string) => string {
  const idMap = new Map<string, string>();
  for (const node of result.snapshot?.nodes ?? []) {
    if (node.runtimeId) idMap.set(node.runtimeId, node.stablePath ?? node.id);
    idMap.set(node.id, node.stablePath ?? node.id);
  }
  for (const node of result.snapshot?.disposedNodes ?? []) {
    if (node.runtimeId) idMap.set(node.runtimeId, node.stablePath ?? node.id);
    idMap.set(node.id, node.stablePath ?? node.id);
  }
  return (id: string) => idMap.get(id) ?? id;
}

function stableScenarioValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableScenarioValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => [key, stableScenarioValue(val)]),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableScenarioValue(value));
}

function operatorFor(mutation: Mutation): string {
  return mutation.operator ?? mutation.name.split(':')[0] ?? mutation.name;
}

function categoryFor(operator: string): NonNullable<Mutation['category']> {
  if (operator === 'remove-assertion') return 'meta';
  if (operator === 'sever-edge' || operator === 'swap-edge') return 'structural';
  if (operator === 'skip-effect' || operator === 'delay-effect') return 'effect';
  return 'semantic';
}

function mutationTargetsVerificationSink(mutation: Mutation, verificationCone: Set<string>): boolean {
  const targetIds = mutation.targetIds ?? [];
  if (targetIds.length === 0) return true;
  return targetIds.some(id => verificationCone.has(id));
}

function verificationReachableNodeIds(graph: CircuitGraph): Set<string> {
  const result = new Set<string>();
  const edges = graph.getEdges();
  const enqueueCone = (rootId: string) => {
    result.add(rootId);
    const queue = [rootId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of edges) {
        if (edge.to !== current || result.has(edge.from)) continue;
        result.add(edge.from);
        queue.push(edge.from);
      }
    }
  };

  for (const assertion of graph.getAssertions()) {
    enqueueCone(assertion.id);
    for (const dep of [
      ...assertion.deps,
      ...(assertion.metadata?.checkDeps ?? []),
      ...(assertion.metadata?.triggerDeps ?? []),
    ]) {
      enqueueCone(dep);
    }
  }

  for (const node of graph.getNodes()) {
    const states = node.metadata?.states;
    if (
      (Array.isArray(states) && states.length > 0)
      || hasFiniteDomainMetadata(node.metadata?.domains)
      || node.metadata?.coverageSink === true
    ) {
      enqueueCone(node.id);
    }
  }

  for (const model of graph.getOperationModels()) {
    for (const dep of [...(model.triggerDeps ?? []), ...(model.outputDeps ?? [])]) {
      enqueueCone(dep);
    }
  }

  return result;
}

function hasFiniteDomainMetadata(domains: unknown): boolean {
  if (Array.isArray(domains)) return domains.length > 0;
  if (!domains || typeof domains !== 'object') return false;
  return Object.values(domains).some(value => Array.isArray(value) && value.length > 0);
}

async function yieldToHost(): Promise<void> {
  await new Promise<void>(resolve => {
    const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame;
    if (typeof raf === 'function') {
      raf(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}
