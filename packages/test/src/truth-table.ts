// truth-table.ts — Observational truth table enumeration

export interface TruthTableSignal {
  nodeId: string;
  set: (v: any) => void;
}

export interface TruthTableRow {
  inputs: boolean[];
  output: any;
  reads: string[];
}

/**
 * Generate all boolean combinations for N signals and evaluate fn for each.
 * Returns the truth table: one row per input combination.
 */
export function enumerateBooleanCombinations(
  signals: TruthTableSignal[],
  evaluate: () => any,
  flush: () => void,
): TruthTableRow[] {
  const n = signals.length;
  const results: TruthTableRow[] = [];

  for (let i = 0; i < (1 << n); i++) {
    const combo = signals.map((_, j) => !!(i & (1 << j)));
    signals.forEach((sig, j) => sig.set(combo[j]));
    flush();
    const output = evaluate();
    results.push({ inputs: combo, output, reads: [] });
  }

  return results;
}
