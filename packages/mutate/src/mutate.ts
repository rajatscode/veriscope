// mutate.ts — Main mutation testing function

import type { CircuitGraph } from '@veriscope/graph';
import { runAutotest } from '@veriscope/test';
import { generateMutations } from './operators.js';
import type { MutateOptions, MutateProgress, MutateResult, Mutation, SkippedMutation } from './types.js';

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
  const { selected: mutations, skipped } = selectMutations(refGraph, candidates, options);

  const survived: MutateResult['survived'] = [];
  const killedMutations: MutateResult['killedMutations'] = [];
  const invalid: MutateResult['invalid'] = [];
  const equivalent: MutateResult['equivalent'] = [];
  let killed = 0;
  let autotestRuns = 0;
  let autotestSteps = 0;
  const yieldEvery = Math.max(1, options.yieldEvery ?? 1);

  const emitProgress = async (completed: number, currentMutation?: string) => {
    if (!options.onProgress) return;
    const progress: MutateProgress = {
      total: mutations.length,
      completed,
      generatedMutants: candidates.length,
      skipped: skipped.length,
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
): { selected: Mutation[]; skipped: SkippedMutation[] } {
  const assertionCone = assertionReachableNodeIds(graph);
  const selected: Mutation[] = [];
  const skipped: SkippedMutation[] = [];
  const explicitOperators = options.operators !== undefined;
  const allowedOperators = Array.isArray(options.operators) ? new Set(options.operators) : null;

  for (const mutation of candidates) {
    const operator = operatorFor(mutation);
    const category = mutation.category ?? categoryFor(operator);

    let reason: string | null = null;
    if (allowedOperators && !allowedOperators.has(operator)) {
      reason = `operator ${operator} was not requested`;
    } else if (!explicitOperators && !DEFAULT_SCORING_OPERATORS.has(operator)) {
      reason = `available in broad mutation mode; excluded from the default semantic score`;
    } else if (!options.includeMetaMutations && category === 'meta') {
      reason = 'meta-mutations are disabled';
    } else if (assertionCone.size > 0 && category !== 'meta' && !mutationTargetsAssertionCone(mutation, assertionCone)) {
      reason = 'outside every assertion backward cone';
    }

    if (reason) {
      skipped.push({
        mutation: mutation.name,
        description: mutation.description,
        reason,
      });
    } else {
      selected.push(mutation);
    }
  }

  return { selected, skipped };
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

function mutationTargetsAssertionCone(mutation: Mutation, assertionCone: Set<string>): boolean {
  const targetIds = mutation.targetIds ?? [];
  if (targetIds.length === 0) return true;
  return targetIds.some(id => assertionCone.has(id));
}

function assertionReachableNodeIds(graph: CircuitGraph): Set<string> {
  const result = new Set<string>();
  const edges = graph.getEdges();
  for (const assertion of graph.getAssertions()) {
    result.add(assertion.id);
    const queue = [assertion.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of edges) {
        if (edge.to !== current || result.has(edge.from)) continue;
        result.add(edge.from);
        queue.push(edge.from);
      }
    }
  }
  return result;
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
