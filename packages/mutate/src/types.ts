// types.ts — Mutation types

import type { CircuitGraph } from '@veriscope/graph';

export interface Mutation {
  name: string;
  description: string;
  apply: (graph: CircuitGraph) => () => void; // returns undo function
}

export interface MutateOptions {
  /** Total exploration budget across all mutations. Default: 500. */
  budget?: number;
  /** Which operators to apply: 'all' or a list of operator names. */
  operators?: 'all' | string[];
}

export interface MutateResult {
  total: number;
  killed: number;
  survived: Array<{ mutation: string; description: string }>;
  score: number; // 0-100
}
