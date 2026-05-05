// types.ts — Mutation types

import type { CircuitGraph } from '@veriscope/graph';

export interface Mutation {
  name: string;
  description: string;
  apply: (graph: CircuitGraph) => () => void; // returns undo function
}

export interface MutateOptions {
  /** Autotest exploration budget used for each mutation. Default: 500. */
  budget?: number;
  /** Which operators to apply: 'all' or a list of operator names. */
  operators?: 'all' | string[];
  /** Include meta-mutations such as remove-assertion. Default: false. */
  includeMetaMutations?: boolean;
}

export interface MutateResult {
  total: number;
  killed: number;
  killedMutations: Array<{
    mutation: string;
    description: string;
    scenarioId?: string;
    assertionName?: string;
  }>;
  survived: Array<{ mutation: string; description: string }>;
  invalid: Array<{ mutation: string; description: string; error: string }>;
  equivalent: Array<{ mutation: string; description: string; reason: string }>;
  score: number; // 0-100
  /** Autotest budget used for every generated mutant. */
  budgetPerMutation: number;
  /** Number of mutated graphs autotested. */
  autotestRuns: number;
  /** Sum of autotest exploration steps across all mutants. */
  autotestSteps: number;
  /** Present only when a randomized/fuzzing runner is used. The default runner is deterministic. */
  seed?: string | number;
}
