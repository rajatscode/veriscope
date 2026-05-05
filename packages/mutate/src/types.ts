// types.ts — Mutation types

import type { CircuitGraph } from '@veriscope/graph';

export interface Mutation {
  name: string;
  description: string;
  operator?: string;
  category?: 'semantic' | 'structural' | 'effect' | 'meta';
  targetIds?: string[];
  apply: (graph: CircuitGraph) => () => void; // returns undo function
}

export interface SkippedMutation {
  mutation: string;
  description: string;
  reason: string;
}

export interface UnobservedMutation {
  mutation: string;
  description: string;
  reason: string;
}

export interface MutateProgress {
  /** Number of mutants selected for scoring in this run. */
  total: number;
  /** Number of selected mutants already autotested. */
  completed: number;
  /** Number of candidate mutants generated before scoring filters. */
  generatedMutants: number;
  /** Number of generated candidates skipped before scoring. */
  skipped: number;
  /** Number of selected-mode candidates with no path to a declared verification sink. */
  unobserved: number;
  currentMutation?: string;
  killed: number;
  survived: number;
  invalid: number;
  equivalent: number;
  budgetPerMutation: number;
  autotestRuns: number;
  autotestSteps: number;
  seed?: string | number;
}

export interface MutateOptions {
  /** Autotest exploration budget used for each mutation. Default: 500. */
  budget?: number;
  /**
   * Which operators to apply. When omitted, Veriscope scores observable
   * semantic operators only. Pass 'all' to include broad structural/effect
   * operators; candidates with no path to a verification sink are reported as
   * unobserved rather than scored.
   */
  operators?: 'all' | string[];
  /** Include meta-mutations such as remove-assertion. Default: false. */
  includeMetaMutations?: boolean;
  /** Progress callback invoked before the run and after each mutant completes. */
  onProgress?: (progress: MutateProgress) => void | Promise<void>;
  /** Yield to the host every N completed mutants. Default: 1. */
  yieldEvery?: number;
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
  unobserved: UnobservedMutation[];
  score: number; // 0-100
  /** Autotest budget used for every generated mutant. */
  budgetPerMutation: number;
  /** Number of mutated graphs autotested. */
  autotestRuns: number;
  /** Sum of autotest exploration steps across all mutants. */
  autotestSteps: number;
  /** Present only when a randomized/fuzzing runner is used. The default runner is deterministic. */
  seed?: string | number;
  /** Number of candidate mutants generated before scoring filters. */
  generatedMutants: number;
  /** Candidate mutants intentionally skipped before scoring. */
  skipped: SkippedMutation[];
}
