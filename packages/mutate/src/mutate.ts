// mutate.ts — Main mutation testing function

import type { CircuitGraph } from '@veriscope/graph';
import { runAutotest } from '@veriscope/test';
import { generateMutations } from './operators.js';
import type { MutateOptions, MutateResult } from './types.js';

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
  let mutations = generateMutations(refGraph);

  // Filter by operator names if specified
  if (options.operators && options.operators !== 'all') {
    const allowed = new Set(options.operators);
    mutations = mutations.filter(m => {
      const opName = m.name.split(':')[0];
      return allowed.has(opName);
    });
  }

  if (!options.includeMetaMutations) {
    mutations = mutations.filter(m => !m.name.startsWith('remove-assertion:'));
  }

  const survived: MutateResult['survived'] = [];
  const killedMutations: MutateResult['killedMutations'] = [];
  const invalid: MutateResult['invalid'] = [];
  const equivalent: MutateResult['equivalent'] = [];
  let killed = 0;
  let autotestRuns = 0;
  let autotestSteps = 0;

  for (const mutation of mutations) {
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
  };
}
