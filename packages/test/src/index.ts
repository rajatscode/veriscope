export { explore } from './explore.js';
export { runAutotest } from './autotest.js';
export type { AutotestOptions } from './autotest.js';
export { backwardCone } from './backward-solve.js';
export { enumerateBooleanCombinations } from './truth-table.js';
export { traceReads } from './read-tracer.js';
export { parseComputeFn } from './fn-parser.js';
export { shrinkSequence } from './shrink.js';
export type {
  CoverageMetric,
  AutotestAssertionResult,
  AutotestResult,
  ExploreCoverage,
  ExploreOptions,
  ExplorePlanSummary,
  ExploreResult,
  Violation,
  ParsedExpression,
} from './types.js';
export type { TruthTableSignal, TruthTableRow } from './truth-table.js';
export type { ShrinkStep } from './shrink.js';
export { discoverMappings, exploreViaInteractions } from './interaction.js';
export type { InteractionMapping } from './interaction.js';
