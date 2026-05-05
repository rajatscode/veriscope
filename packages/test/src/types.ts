// types.ts — ExploreResult, Violation, and related types
import type { CoverageGap, GraphSnapshot } from '@veriscope/graph';

export interface Violation {
  assertionName: string;
  tick: number;
  signalValues: Record<string, any>;
  sequence: Array<{ signal: string; value: any }>;
}

export interface ScenarioTrace {
  id: string;
  kind: 'enumerated' | 'current-state' | 'coverage-completion' | 'adversarial';
  tick: number;
  steps: Array<{ signal: string; value: any }>;
  assertions: string[];
  violations: string[];
}

export interface ExploreOptions {
  /** Maximum number of exploration steps. Default: 1000. */
  budget?: number;
  /** Flush function for framework integration (React: () => act(() => {}), Solid: () => {}). */
  flush?: () => void | Promise<void>;
}

export interface CoverageMetric {
  covered: number;
  total: number;
  percentage: number;
}

export interface ExploreCoverage {
  toggle: CoverageMetric;
  transitions: CoverageMetric;
  cross: CoverageMetric;
  operations: CoverageMetric;
  overall: CoverageMetric;
  gaps: CoverageGap[];
}

export interface ExploreResult {
  violations: Violation[];
  coverage: ExploreCoverage;
  steps: number;
  scenarios: ScenarioTrace[];
  snapshot?: GraphSnapshot;
}

export interface AutotestAssertionResult {
  id: string;
  name: string;
  kind: string;
  status: 'passed' | 'failed';
  partialCoverage: boolean;
  reason?: string;
}

export interface AutotestResult {
  status: 'passed' | 'failed';
  assertions: AutotestAssertionResult[];
  violations: Violation[];
  scenarios: ScenarioTrace[];
  coverage: ExploreCoverage;
  steps: number;
  snapshot?: GraphSnapshot;
}

export interface ParsedExpression {
  signals: string[];
  comparisons: Array<{ signal: string; op: string; value: string }>;
  branches?: number;
}
