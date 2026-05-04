// types.ts — ExploreResult, Violation, and related types

export interface Violation {
  assertionName: string;
  tick: number;
  signalValues: Record<string, any>;
  sequence: Array<{ signal: string; value: any }>;
}

export interface ExploreOptions {
  /** Maximum number of exploration steps. Default: 1000. */
  budget?: number;
  /** Flush function for framework integration (React: act(), Solid: no-op). */
  flush?: () => void;
}

export interface ExploreResult {
  violations: Violation[];
  coverage: {
    toggle: number;
    transitions: number;
    cross: number;
  };
  steps: number;
}

export interface ParsedExpression {
  signals: string[];
  comparisons: Array<{ signal: string; op: string; value: string }>;
}
