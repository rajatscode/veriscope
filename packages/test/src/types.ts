// types.ts — ExploreResult, Violation, and related types
import type { CoverageGap, GraphSnapshot } from '@veriscope/graph';

export interface Violation {
  assertionName: string;
  tick: number;
  signalValues: Record<string, any>;
  sequence: Array<{ signal: string; value: any }>;
}

export interface ScenarioObservation {
  type:
    | 'signal-change'
    | 'derived-recompute'
    | 'assertion-armed'
    | 'assertion-passed'
    | 'assertion-failed'
    | 'operation-begin'
    | 'operation-resolve'
    | 'operation-reject'
    | 'operation-abort'
    | 'operation-timeout'
    | 'operation-stale';
  node: string;
  nodeId?: string;
  oldValue?: any;
  newValue?: any;
  operationId?: string;
  operationName?: string;
  status?: string;
}

export interface ScenarioTrace {
  id: string;
  kind: 'enumerated' | 'current-state' | 'sequence' | 'operation-outcome' | 'coverage-directed' | 'coverage-completion' | 'adversarial';
  tick: number;
  steps: Array<{ signal: string; value: any }>;
  assertions: string[];
  violations: string[];
  observations?: ScenarioObservation[];
}

export interface ExploreProgress {
  phase: ScenarioTrace['kind'] | 'setup' | 'complete';
  steps: number;
  budget: number;
  generatedCases: number;
  hiddenDuplicateCases: number;
  stoppedByBudget: boolean;
}

export interface ExploreOptions {
  /** Maximum number of exploration steps. Default: 1000. */
  budget?: number;
  /** Flush function for framework integration (React: () => act(() => {}), Solid: () => {}). */
  flush?: () => void | Promise<void>;
  /** Progress callback invoked as deterministic generated cases are executed. */
  onProgress?: (progress: ExploreProgress) => void | Promise<void>;
}

export interface ExplorePlanSummary {
  deterministic: boolean;
  seed?: string | number;
  budget: number;
  exhausted: boolean;
  stoppedByBudget: boolean;
  generatedCases: number;
  hiddenDuplicateCases: number;
  generatedReachableCoverage: CoverageMetric;
  phaseCounts: Record<ScenarioTrace['kind'], number>;
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
  plan: ExplorePlanSummary;
  snapshot?: GraphSnapshot;
}

export interface AutotestAssertionResult {
  id: string;
  name: string;
  kind: string;
  status: 'passed' | 'failed';
  partialCoverage: boolean;
  confidence: 'verified' | 'partial' | 'unverifiable';
  reason?: string;
  exercised: boolean;
  scenarioCount: number;
  passScenarioCount: number;
  failScenarioCount: number;
}

export interface AutotestConfidenceSummary {
  verified: number;
  partial: number;
  unverifiable: number;
}

export interface AutotestResult {
  status: 'passed' | 'failed';
  assertions: AutotestAssertionResult[];
  confidence: AutotestConfidenceSummary;
  violations: Violation[];
  scenarios: ScenarioTrace[];
  coverage: ExploreCoverage;
  steps: number;
  snapshot?: GraphSnapshot;
  plan: ExplorePlanSummary;
}

export interface ParsedExpression {
  signals: string[];
  comparisons: Array<{ signal: string; op: string; value: string }>;
  branches?: number;
}
