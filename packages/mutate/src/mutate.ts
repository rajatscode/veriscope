// mutate.ts — Main mutation testing function

import type { CircuitGraph } from '@veriscope/graph';
import { explore } from '@veriscope/test';
import { generateMutations } from './operators.js';
import type { MutateOptions, MutateResult } from './types.js';

/**
 * Run mutation testing on a reactive graph.
 *
 * @param factory Function that creates a fresh CircuitGraph for each mutation run
 * @param options Configuration options
 * @returns Mutation testing results including kill rate
 */
export function mutate(
  factory: () => CircuitGraph,
  options: MutateOptions = {},
): MutateResult {
  const budget = options.budget ?? 500;

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

  const survived: MutateResult['survived'] = [];
  let killed = 0;

  const budgetPerMutation = mutations.length > 0 ? Math.max(4, Math.floor(budget / mutations.length)) : budget;

  for (const mutation of mutations) {
    // Fresh graph for each mutation
    const graph = factory();

    // Apply mutation
    const undo = mutation.apply(graph);

    // Explore the mutated graph
    const result = explore(graph, { budget: budgetPerMutation });

    if (result.violations.length > 0) {
      killed++;
    } else {
      survived.push({ mutation: mutation.name, description: mutation.description });
    }

    undo();
  }

  return {
    total: mutations.length,
    killed,
    survived,
    score: mutations.length > 0 ? (killed / mutations.length) * 100 : 100,
  };
}
