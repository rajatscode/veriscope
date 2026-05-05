# @veriscope/coverage

Formats, merges, threshold-checks, and persists Veriscope reactive coverage reports (toggle, FSM transition, and cross coverage) with built-in Vitest integration.

## Installation

```bash
npm install @veriscope/coverage
```

## Quick Example

```ts
import { coverage } from '@veriscope/graph';
import { formatConsole, checkThresholds } from '@veriscope/coverage';

// ... run your tests, which exercise reactive signals ...

const report = coverage.getReport();

// Print a formatted console report
console.log(formatConsole(report));

// Enforce minimum coverage in CI
const result = checkThresholds(report, { overall: 80, toggle: 90 });
if (!result.pass) {
  console.error('Coverage failures:', result.failures);
  process.exit(1);
}
```

### Vitest Integration

```ts
// vitest.config.ts
import { veriscopeCoverageReporter } from '@veriscope/coverage';

export default {
  reporters: [
    'default',
    veriscopeCoverageReporter({
      format: 'console',
      thresholds: { overall: 80 },
    }),
  ],
};
```

## API Reference

### Formatting

#### `formatConsole(report: CoverageReport): string`

Formats a coverage report as aligned, human-readable text for terminal output. Includes sections for toggle coverage (signal / true / false / covered), FSM transition coverage (observed/possible counts per FSM), cross coverage (observed combinations per group with percentages), and a summary with total points, covered points, and overall percentage.

#### `formatJSON(report: CoverageReport): string`

Serializes a coverage report to a pretty-printed JSON string. Converts internal `Map` and `Set` structures to plain objects and arrays for JSON compatibility. Suitable for CI artifact storage or machine consumption.

#### `formatHTML(report: CoverageReport): string`

Renders a coverage report as a self-contained HTML page. Includes:
- A color-coded summary banner (green at >= 80%, red below).
- A toggle coverage table with green/red cells for each signal's seen-true and seen-false status.
- FSM transition matrices (from/to grid) with covered cells highlighted green and uncovered cells red.
- Cross coverage tables showing observed and uncovered combinations per group.

### Thresholds

#### `checkThresholds(report: CoverageReport, thresholds: CoverageThresholds): ThresholdResult`

Checks a coverage report against the provided thresholds. Returns a `ThresholdResult` indicating pass/fail with detailed failure messages.

Coverage calculation per category:
- **Toggle**: each signal contributes 2 points (seenTrue + seenFalse). Percentage = covered points / (signals * 2) * 100.
- **Transitions**: percentage = total observed transitions / total possible transitions across all FSMs, where possible = states * (states - 1) per FSM.
- **Cross**: percentage = total observed combinations / total possible combinations across all groups.
- **Overall**: uses the report's built-in `summary.percentage`.

If no coverage points exist for a given category, that category is treated as 100% (passes any threshold).

#### `CoverageThresholds`

```ts
interface CoverageThresholds {
  /** Minimum toggle coverage percentage (0-100). */
  toggle?: number;
  /** Minimum transition coverage percentage (0-100). */
  transitions?: number;
  /** Minimum cross coverage percentage (0-100). */
  cross?: number;
  /** Minimum overall coverage percentage (0-100). */
  overall?: number;
}
```

All fields are optional. Only specified thresholds are checked.

#### `ThresholdResult`

```ts
interface ThresholdResult {
  pass: boolean;
  failures: string[];
}
```

- `pass` -- `true` if all specified thresholds are met.
- `failures` -- array of human-readable failure messages, e.g. `"Toggle coverage 50.0% < threshold 90%"`.

### Merging

#### `mergeCoverageReports(...reports: CoverageReport[]): CoverageReport`

Merges multiple coverage reports into a single aggregate report. Useful for combining coverage from parallel or sequential test runs.

Merge strategy per category:
- **Toggle**: OR union of `seenTrue`/`seenFalse` across reports for each signal.
- **Transitions**: union of transition keys per FSM, with counts summed. States sets are also unioned.
- **Cross**: union of observed combinations per group, with counts summed. `total` takes the max across reports.
- **Summary**: recalculated from the merged data.

#### `saveCoverageToFile(report: CoverageReport, path: string): void`

Serializes a coverage report to JSON and writes it synchronously to the given file path. Converts `Map`/`Set` structures to plain objects/arrays for JSON compatibility. Requires Node.js (`fs` module).

#### `loadCoverageFromFile(path: string): CoverageReport`

Reads a JSON coverage file from disk and deserializes it back into a `CoverageReport` with proper `Map` and `Set` structures. Requires Node.js (`fs` module). The file must have been written by `saveCoverageToFile` or `formatJSON` (with the same schema).

### Vitest Reporter

#### `veriscopeCoverageReporter(options?: VeriscopeCoverageReporterOptions): object`

Creates a Vitest-compatible reporter object that outputs Veriscope reactive coverage after the test run completes. The returned object has a `name` property (`"veriscope-coverage"`) and an `onTestRunEnd` hook.

Behavior:
1. When the test run ends, it retrieves the coverage report from `coverage.getReport()` or `options.getReport`, then merges any `options.inputFiles` written by test workers.
2. Formats the report according to `options.format`.
3. If `options.outputFile` is set, writes the formatted output to that file; otherwise prints to stdout.
4. If `options.thresholds` is set, checks thresholds and sets `process.exitCode = 1` on failure, printing failure details to stderr.

#### `VeriscopeCoverageReporterOptions`

```ts
interface VeriscopeCoverageReporterOptions {
  /** Format: 'console' | 'json' | 'html'. Default: 'console'. */
  format?: 'console' | 'json' | 'html';
  /** Coverage thresholds -- fail the run if not met. */
  thresholds?: CoverageThresholds;
  /** Output file path for json/html format. */
  outputFile?: string;
  /** Coverage JSON files emitted by test workers to merge at report time. */
  inputFiles?: string[];
  /** If provided, called to get the CoverageReport (for testability). Otherwise uses global singleton. */
  getReport?: () => CoverageReport;
}
```

Vitest reporters run outside test workers, so worker-collected coverage should be written with `saveCoverageToFile()` and passed back through `inputFiles` when you need real integration coverage from a full Vitest run.

### Re-exported Types from `@veriscope/graph`

The formatting and threshold functions accept `CoverageReport` from `@veriscope/graph`, which has the following shape:

```ts
interface CoverageReport {
  toggle: ToggleCoverage[];
  transitions: TransitionCoverage[];
  cross: CrossCoverage[];
  summary: { totalPoints: number; coveredPoints: number; percentage: number };
}

interface ToggleCoverage {
  signalId: string;
  seenTrue: boolean;
  seenFalse: boolean;
}

interface TransitionCoverage {
  fsmId: string;
  transitions: Map<string, number>; // "stateA->stateB" -> count
  states: Set<string>;
}

interface CrossCoverage {
  groupId: string;
  signals: string[];
  observed: Map<string, number>; // "1,0,1" -> count
  total: number; // 2^n possible combos for n boolean signals
}
```
