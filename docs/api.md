# Veriscope API Reference

Complete API documentation for all `@veriscope/*` packages. Organized by concept.

---

## Table of Contents

1. [Signals & Derived Values](#1-signals--derived-values)
2. [Assertions](#2-assertions)
3. [Graph & Diffing](#3-graph--diffing)
4. [Coverage](#4-coverage)
5. [Testing & Exploration](#5-testing--exploration)
6. [Mutation Testing](#6-mutation-testing)
7. [Devtools](#7-devtools)
8. [CLI](#8-cli)

---

## 1. Signals & Derived Values

Veriscope's reactivity is built on signals (mutable state) and derived values (computed state), all registered in an introspectable `CircuitGraph`.

### Core Types (`@veriscope/graph`)

```ts
interface ReadonlySignal<T> {
  readonly val: T;
  readonly nodeId: string;
  readonly name: string;
}

interface Signal<T> extends ReadonlySignal<T> {
  set(next: T): void;
}

type NodeType = 'signal' | 'derived' | 'effect' | 'assertion';
```

### React Hooks (`@veriscope/react`)

#### `useSignal<T>(initialValue, name, options?)`

Creates a mutable signal registered in the CircuitGraph.

```ts
function useSignal<T>(
  initialValue: T,
  name: string,
  options?: {
    states?: string[];
    graph?: CircuitGraph;
  },
): Signal<T>;
```

- `.val` -- synchronous read (ref-backed, never stale)
- `.set(next)` -- updates the value, skips on `Object.is` equality, triggers React re-render + `graph.notifyChange()`
- `options.states` -- optional FSM state enumeration for coverage
- `options.graph` -- defaults to the global singleton

#### `useDerived<T>(computeFn, deps, name, options?)`

Creates a read-only derived signal that recomputes when dependencies change.

```ts
function useDerived<T>(
  computeFn: () => T,
  deps: Array<Signal<any> | ReadonlySignal<any>>,
  name: string,
  options?: { graph?: CircuitGraph },
): ReadonlySignal<T>;
```

Only notifies the graph when the recomputed value actually changes (`Object.is` comparison).

#### `useTrackedEffect(fn, deps, name, options?)`

Runs a side effect on dependency changes, registered in the graph.

```ts
function useTrackedEffect(
  fn: () => void | (() => void),
  deps: Array<Signal<any> | ReadonlySignal<any>>,
  name: string,
  options?: { graph?: CircuitGraph },
): void;
```

May return a cleanup function (same contract as `useEffect`). Each execution calls `graph.notifyEffect()`.

#### `useEdgeEffect(signal, edge, action, name, options?)`

Fires an action on a boolean edge transition (posedge/negedge).

```ts
function useEdgeEffect(
  signal: Signal<any> | ReadonlySignal<any>,
  edge: 'posedge' | 'negedge',
  action: () => void,
  name: string,
  options?: { graph?: CircuitGraph },
): void;
```

- `'posedge'` -- falsy to truthy transition
- `'negedge'` -- truthy to falsy transition
- Initial render is skipped; only actual transitions fire

#### Graph Injection for Testing

All hooks accept `options.graph` for isolated testing:

```tsx
const testGraph = new CircuitGraph();
const { result } = renderHook(() => {
  const count = useSignal(0, 'count', { graph: testGraph });
  const doubled = useDerived(() => count.val * 2, [count], 'doubled', { graph: testGraph });
  return { count, doubled };
});
```

### Solid Hooks (`@veriscope/solid`)

Identical API signatures to the React hooks:

```ts
function useSignal<T>(initial: T, name: string, options?: { states?: string[]; graph?: CircuitGraph }): Signal<T>
function useDerived<T>(fn: () => T, deps: Array<Signal<any> | ReadonlySignal<any>>, name: string, options?: { graph?: CircuitGraph }): ReadonlySignal<T>
function useTrackedEffect(fn: () => void | (() => void), deps: Array<Signal<any> | ReadonlySignal<any>>, name: string, options?: { graph?: CircuitGraph }): void
function useEdgeEffect(signal: Signal<any> | ReadonlySignal<any>, edge: 'posedge' | 'negedge', action: () => void, name: string, options?: { graph?: CircuitGraph }): void
```

**Key Solid-specific differences:**

| Concern | Solid | React |
|---------|-------|-------|
| Signal storage | `createSignal` | `useState` + `useRef` bridge |
| Derived computation | `createMemo` (lazy, cached) | `useMemo` + subscriber set |
| Effect scheduling | `createEffect` (synchronous) | `useEffect` (after paint) |
| Cleanup | `onCleanup` | `useEffect` return |
| Re-renders | None (fine-grained DOM updates) | Every `.set()` triggers re-render |
| Graph registration | Inline on first call | `useRef` null-check pattern |

---

## 2. Assertions

HDL-inspired assertion primitives for invariant checking and temporal properties.

### `assertAlways(checkFn, name, targetGraph?)` (`@veriscope/graph`)

Registers an assertion that must hold every time `checkAssertions()` is called.

```ts
function assertAlways(
  checkFn: () => boolean,
  name: string,
  targetGraph?: CircuitGraph,
): string  // returns assertion node ID
```

### `assertNever(checkFn, name, targetGraph?)` (`@veriscope/graph`)

Registers an assertion that must **never** hold. Internally inverts `checkFn` and delegates to `assertAlways`.

```ts
function assertNever(
  checkFn: () => boolean,
  name: string,
  targetGraph?: CircuitGraph,
): string
```

### `assertAfter(signal, edge, operator, checkFn, options, targetGraph?)` (`@veriscope/graph`)

Temporal assertion: after a signal edge, a property must hold within a time bound.

```ts
function assertAfter(
  signal: { nodeId: string },
  edge: 'posedge' | 'negedge',
  operator: 'immediately' | 'eventually' | { withinTicks: number },
  checkFn: () => boolean,
  options: {
    name: string;
    edgeValue?: any;
    devWatchdogMs?: number;
  },
  targetGraph?: CircuitGraph,
): string
```

- `'immediately'` -- `checkFn` must be true in the same tick as the edge
- `'eventually'` -- must become true at some point; `devWatchdogMs` fires a failure timer
- `{ withinTicks: N }` -- must become true within `N` ticks of the edge

### `AssertionViolation`

```ts
interface AssertionViolation {
  nodeId: string;
  name: string;
  kind: 'always' | 'never' | 'after';
  tick: number;
}
```

---

## 3. Graph & Diffing

### Class: `CircuitGraph` (`@veriscope/graph`)

The core dependency graph. A default singleton is exported as `graph`.

```ts
import { CircuitGraph, graph } from '@veriscope/graph';
```

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `currentTick` | `number` (readonly) | Current simulation tick |

#### Node Management

```ts
registerNode(info: { name: string; type: NodeType; deps?: string[]; metadata?: Record<string, any> }): string
addEdge(from: string, to: string): void
setNodeValue(id: string, getter: () => any): void
setNodeSetter(id: string, setter: (v: any) => void): void
setAssertionFn(id: string, fn: () => boolean, kind: 'always' | 'never' | 'after'): void
disposeNode(id: string): void
```

#### Event Notifications

```ts
notifyChange(nodeId: string, oldValue: any, newValue: any): void
notifyEffect(nodeId: string): void
notifyAssertionArmed(nodeId: string): void
notifyAssertionPassed(nodeId: string): void
notifyAssertionFailed(nodeId: string): void
```

`notifyChange` records events, waveform data, toggle coverage, CDC analysis, and fires subscribers.

#### Queries

```ts
getNodes(): GraphNode[]
getEdges(): GraphEdge[]
getNode(id: string): GraphNode | undefined
getAssertions(): Array<{ id: string; name: string; kind: string; checkFn: () => boolean; deps: string[] }>
checkAssertions(): AssertionViolation[]
getRecentEvents(n?: number): GraphEvent[]  // default 50, max 256
```

#### Subscriptions

```ts
subscribe(listener: (event: GraphEvent) => void): () => void
```

#### Snapshots and Diffing

```ts
snapshot(): GraphSnapshot
static diffGraphs(a: GraphSnapshot, b: GraphSnapshot): GraphDiff
```

#### Tick Management

```ts
enterTestMode(): void    // manual tick control
openTick(): void
runInTick<T>(fn: () => T): T
batch<T>(fn: () => T): T
closeTick(): void
flushTick(settle?: () => void | Promise<void>): Promise<void>
exitTestMode(): void     // auto-tick resumes
```

#### Coverage Integration

```ts
enableCoverage(): void
disableCoverage(): void
```

#### CDC (Clock-Domain Crossing) Analysis

```ts
setAsyncContext(isAsync: boolean): void
getNodeLastSetContext(nodeId: string): 'sync' | 'async' | undefined
onCdcWarning(listener: (warning: CdcWarning) => void): () => void
```

#### Waveform Recording

```ts
startRecording(): void
stopRecording(): void
getWaveformData(): Map<string, Array<{ t: number; v: any }>>
```

Buffer limit: 2000 samples per node.

#### Reset

```ts
reset(): void  // clears all state
```

### Graph Types

```ts
interface GraphNode {
  id: string;
  name: string;
  type: NodeType;
  deps: string[];
  getValue: (() => any) | null;
  setValue: ((v: any) => void) | null;
  assertionFn?: () => boolean;
  assertionKind?: 'always' | 'never' | 'after';
  metadata?: Record<string, any>;
  trigger?: { element: string; action: 'click' | 'type' | 'select'; value?: string };
}

interface GraphEdge {
  from: string;
  to: string;
}

interface GraphEvent {
  type: 'signal-change' | 'derived-recompute' | 'effect-run'
      | 'assertion-armed' | 'assertion-passed' | 'assertion-failed';
  nodeId: string;
  tick: number;
  oldValue?: any;
  newValue?: any;
}

interface GraphSnapshot {
  nodes: Array<{ id: string; name: string; type: string; deps: string[] }>;
  edges: GraphEdge[];
}

interface GraphDiff {
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: Array<{ id: string; before: any; after: any }>;
  addedEdges: GraphEdge[];
  removedEdges: GraphEdge[];
}

interface CdcWarning {
  type: 'cdc-async-unguarded';
  signalId: string;
  signalName: string;
  derivedId: string;
  derivedName: string;
  tick: number;
}
```

### Programmatic Diff API (`@veriscope/cli`)

```ts
function diffSnapshots(pathA: string, pathB: string): GraphDiff
function loadSnapshot(path: string): GraphSnapshot
function formatDiff(diff: GraphDiff): string
function writeSnapshot(graph: CircuitGraph, outputPath: string): void
```

---

## 4. Coverage

### `CoverageCollector` Class (`@veriscope/graph`)

HDL-style coverage collection. A singleton is exported as `coverage`.

```ts
import { CoverageCollector, coverage } from '@veriscope/graph';
```

```ts
enable(): void
disable(): void
isEnabled(): boolean
recordToggle(signalId: string, value: boolean): void
recordTransition(fsmId: string, from: string, to: string): void
registerCrossGroup(groupId: string, signalIds: string[]): void
recordCross(groupId: string, values: boolean[]): void
getPreviousValue(signalId: string): any
setPreviousValue(signalId: string, value: any): void
getReport(): CoverageReport
reset(): void
```

### Coverage Types

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
  transitions: Map<string, number>;  // "stateA->stateB" -> count
  states: Set<string>;
}

interface CrossCoverage {
  groupId: string;
  signals: string[];
  observed: Map<string, number>;  // "1,0,1" -> count
  total: number;                  // 2^n possible combos
}
```

### Formatting (`@veriscope/coverage`)

```ts
function formatConsole(report: CoverageReport): string  // aligned text for terminal
function formatJSON(report: CoverageReport): string     // pretty-printed JSON (Map/Set -> plain objects)
function formatHTML(report: CoverageReport): string      // self-contained HTML page with color-coded tables
```

### Thresholds (`@veriscope/coverage`)

```ts
function checkThresholds(report: CoverageReport, thresholds: CoverageThresholds): ThresholdResult

interface CoverageThresholds {
  toggle?: number;       // 0-100
  transitions?: number;  // 0-100
  cross?: number;        // 0-100
  overall?: number;      // 0-100
}

interface ThresholdResult {
  pass: boolean;
  failures: string[];  // e.g. "Toggle coverage 50.0% < threshold 90%"
}
```

Categories with no coverage points are treated as 100% (pass any threshold).

### Merging & Persistence (`@veriscope/coverage`)

```ts
function mergeCoverageReports(...reports: CoverageReport[]): CoverageReport
function saveCoverageToFile(report: CoverageReport, path: string): void
function loadCoverageFromFile(path: string): CoverageReport
```

Merge strategy: toggle OR-unions `seenTrue`/`seenFalse`, transitions/cross sum counts and union keys.

### Vitest Reporter (`@veriscope/coverage`)

```ts
function veriscopeCoverageReporter(options?: VeriscopeCoverageReporterOptions): object

interface VeriscopeCoverageReporterOptions {
  format?: 'console' | 'json' | 'html';  // default: 'console'
  thresholds?: CoverageThresholds;
  outputFile?: string;
  inputFiles?: string[];                 // worker-emitted reports to merge
  getReport?: () => CoverageReport;       // for testability
}
```

Returns a Vitest-compatible reporter with `name: "veriscope-coverage"` and `onTestRunEnd` hook. It merges `inputFiles` with the process-local report and sets `process.exitCode = 1` on threshold failure.

```ts
// vitest.config.ts
import { veriscopeCoverageReporter } from '@veriscope/coverage';

export default {
  reporters: [
    'default',
    veriscopeCoverageReporter({ format: 'console', thresholds: { overall: 80 } }),
  ],
};
```

---

## 5. Testing & Exploration

### `explore(graph, options?)` (`@veriscope/test`)

Main entry point for automated state-space exploration.

```ts
function explore(graph: CircuitGraph, options?: ExploreOptions): Promise<ExploreResult>

interface ExploreOptions {
  budget?: number;                      // default: 1000
  flush?: () => void | Promise<void>;   // framework integration (React: () => act(() => {}))
}

interface ExploreResult {
  violations: Violation[];
  coverage: { toggle: number; transitions: number; cross: number };
  steps: number;
}

interface Violation {
  assertionName: string;
  tick: number;
  signalValues: Record<string, any>;
  sequence: Array<{ signal: string; value: any }>;
}
```

**Behavior:**

1. Enters test mode on the graph
2. Discovers all assertions and computes backward cones to find relevant root signals
3. Enumerates all `2^n` boolean input combinations (for 1--12 boolean roots)
4. Resolves pending `eventually` assertions by parsing check functions and driving signals
5. Runs an adversarial pass that actively tries to break assertions
6. Returns violations, coverage counters, and total steps

### `backwardCone(graph, targetNodeId)` (`@veriscope/test`)

Finds all root signals (zero incoming edges) affecting a node via BFS.

```ts
function backwardCone(graph: CircuitGraph, targetNodeId: string): string[]
```

### `enumerateBooleanCombinations(signals, evaluate, flush)` (`@veriscope/test`)

Generates all `2^n` boolean input combinations for truth table construction.

```ts
function enumerateBooleanCombinations(
  signals: TruthTableSignal[],
  evaluate: () => any,
  flush: () => void,
): TruthTableRow[]

interface TruthTableSignal { nodeId: string; set: (v: any) => void }
interface TruthTableRow { inputs: boolean[]; output: any; reads: string[] }
```

### `traceReads(fn, signals)` (`@veriscope/test`)

Discovers which signals are read during function execution by intercepting `.val` getters.

```ts
function traceReads(
  fn: () => any,
  signals: Map<string, { val: any }>,
): { result: any; reads: string[] }
```

### `parseComputeFn(fn)` (`@veriscope/test`)

Parses a function's source using Acorn to extract signal reads, comparisons, and branch count.

```ts
function parseComputeFn(fn: () => any): ParsedExpression | null

interface ParsedExpression {
  signals: string[];
  comparisons: Array<{ signal: string; op: string; value: string }>;
  branches?: number;
}
```

### `shrinkSequence(sequence, replay)` (`@veriscope/test`)

Delta-debugging-style bisection to minimize violation reproductions.

```ts
function shrinkSequence(
  sequence: ShrinkStep[],
  replay: (seq: ShrinkStep[]) => boolean,
): ShrinkStep[]

interface ShrinkStep { signal: string; value: any }
```

### `discoverMappings(graph, interactions, perform)` (`@veriscope/test`)

Discovers which signals change when UI interactions occur.

```ts
function discoverMappings(
  graph: CircuitGraph,
  interactions: Array<{ element: string; action: string; value?: string }>,
  perform: (interaction: { element: string; action: string; value?: string }) => void,
): InteractionMapping[]

interface InteractionMapping {
  signalId: string;
  trigger: { element: string; action: 'click' | 'type' | 'select'; value?: string };
}
```

### `exploreViaInteractions(graph, mappings, perform, options?)` (`@veriscope/test`)

Drives exploration through UI interactions instead of raw signal writes.

```ts
function exploreViaInteractions(
  graph: CircuitGraph,
  mappings: InteractionMapping[],
  perform: (trigger: InteractionMapping['trigger']) => void,
  options?: { budget?: number },  // default: 100
): void
```

---

## 6. Mutation Testing

### `mutate(factory, options?)` (`@veriscope/mutate`)

Run mutation testing on a reactive graph to measure assertion quality.

```ts
function mutate(
  factory: () => CircuitGraph,
  options?: MutateOptions,
): Promise<MutateResult>

interface MutateOptions {
  budget?: number;                 // default: 500, divided among mutations (min 4 each)
  operators?: 'all' | string[];   // default: 'all'; or e.g. ['negate', 'sever-edge']
}

interface MutateResult {
  total: number;
  killed: number;
  survived: Array<{ mutation: string; description: string }>;
  score: number;  // 0-100 kill rate
}
```

**How it works:**

1. Creates a reference graph from `factory` to enumerate mutations via `generateMutations`
2. For each mutation, creates a fresh graph, applies the mutation, runs `explore()`
3. If any assertion fires, the mutation is **killed**; otherwise it **survived**
4. Score = `(killed / total) * 100`

### `generateMutations(graph)` (`@veriscope/mutate`)

```ts
function generateMutations(graph: CircuitGraph): Mutation[]

interface Mutation {
  name: string;                              // e.g. "sever-edge:a->b"
  description: string;
  apply: (graph: CircuitGraph) => () => void;  // returns undo function
}
```

### Mutation Operators

| Operator | Name prefix | Applies to | What it does |
|----------|------------|------------|--------------|
| Sever edge | `sever-edge` | Edges with valued source | Replaces source value with default (`false`/`0`) |
| Negate | `negate` | Boolean signals | Inverts the boolean value |
| Constant-fold | `constant-fold` | Derived nodes | Replaces computation with a constant |
| Swap edge | `swap-edge` | Same-type signal pairs | Makes one signal read the other's value |
| Skip effect | `skip-effect` | Effect nodes | Replaces effect with no-op |
| Invert comparison | `invert-comparison` | Boolean derived nodes | Negates the boolean result |
| Remove assertion | `remove-assertion` | Assertion nodes | Makes assertion always pass |
| Delay effect | `delay-effect` | Effect nodes | Wraps action in `setTimeout(..., 0)` |

---

## 7. Devtools

### `mountDevtools(container, graph, options?)` (`@veriscope/devtools`)

Mount the devtools panel into a DOM element.

```ts
function mountDevtools(
  container: HTMLElement,
  graph: CircuitGraph,
  options?: DevtoolsOptions,
): DevtoolsHandle;

interface DevtoolsOptions {
  coverage?: CoverageCollector; // shown inside Autotest runtime coverage
  autotest?: typeof runAutotest;
  explore?: typeof explore;     // fallback when no autotest runner is provided
  mutate?: () => Promise<MutateResult>;
  initialTab?: TabId;           // default: 'circuit'
  height?: string;              // default: '360px'
}

interface DevtoolsHandle {
  dispose(): void;
  refresh(): void;
  setTab(tab: TabId): void;
}

type TabId = 'circuit' | 'waveform' | 'autotest' | 'mutants';
```

### Tabs

#### Circuit

Live dependency graph visualizer. Topological layer layout (left-to-right). Color-coded nodes:
- Signal: `#6ee7f9`, Derived: `#a78bfa`, Effect: `#72f1b8`, Assertion: `#ff5d8f`
- Bezier curve edges with arrowheads, hover tooltip with name/type/value/dep count
- Subscribes to graph events so topology, values, and assertion state redraw while the app runs

#### Waveform

Time-series viewer for all signal and derived nodes. Features:
- Hierarchy browser with collapsible groups and per-signal visibility/render-mode toggles
- Dual markers (click = A, shift-click = B, alt/meta = snap to edge) with delta-t display
- Cross-signal search: `signal > 5`, `signal rises`, `A rises AND B == false`, `A rises WITHIN 10 OF B falls`
- Boolean signals as filled regions, numeric as analog/digital, assertions as colored overlays
- Export to JSON, zoom controls, keyboard shortcuts (`+`/`-` zoom, arrows pan, Home fit, Esc clear markers)
- Persistence via `localStorage`

#### Autotest

Live assertion/autotest surface. Subscribes to graph events for real-time pass/fail/armed tracking. When provided, `runAutotest()` drives exploration and reports assertion status, coverage percentage, and explicit coverage gaps. Runtime `CoverageCollector` summaries are shown here too.

#### Mutants

Mutation testing surface. Provide a callback backed by `@veriscope/mutate` to run generated mutations, rerun autotest, and report killed, survived, invalid, and equivalent mutations.

### Panel Constructors

```ts
function createTabLayout(container: HTMLElement): TabLayout
function createWaveformPanel(container: HTMLElement, graph: CircuitGraph): { dispose: () => void; refresh: () => void }
function createVisualizerPanel(container: HTMLElement, graph: CircuitGraph): { dispose: () => void; refresh: () => void }
```

### Types

```ts
interface WaveformSignal {
  id: string;
  displayName: string;
  group: string;
  type: 'boolean' | 'numeric' | 'enum' | 'assertion' | 'coverage';
  visible: boolean;
  color: string;
  renderMode: 'analog' | 'digital';
}

interface TabDefinition {
  id: TabId;
  label: string;
}

interface TabLayout {
  container: HTMLElement;
  tabBar: HTMLElement;
  contentPanels: Map<TabId, HTMLElement>;
  activeTab: TabId;
  setActive: (tab: TabId) => void;
  onTabChange: (cb: (tab: TabId) => void) => void;
  dispose: () => void;
}
```

---

## 8. CLI

### Installation

```bash
npm install @veriscope/cli
```

### Commands

#### `veriscope diff <graph-a.json> <graph-b.json>`

Compares two graph snapshot JSON files and prints structural differences.

```bash
veriscope diff before.json after.json
```

Output sections (only printed when differences exist):
- `+ node` -- added nodes
- `- node` -- removed nodes
- `~ id: typeBefore -> typeAfter` -- changed nodes
- `+ from -> to` -- added edges
- `- from -> to` -- removed edges

Exit codes: `0` success, `1` missing arguments or invalid snapshot schema.

#### `veriscope validate <graph.json>`

Validates a graph snapshot artifact and prints a short summary.

```bash
veriscope validate ./my-graph.json
```

Exit codes: `0` success, `1` missing file path or invalid snapshot schema.

Snapshot capture must happen inside the app/test process that owns the graph:

```ts
import { writeSnapshot } from '@veriscope/cli';

writeSnapshot(graph, './my-graph.json', { harness: 'checkout-flow' });
```

### Programmatic API

```ts
function diffSnapshots(pathA: string, pathB: string): GraphDiff
function loadSnapshot(path: string): GraphSnapshot
function validateSnapshot(value: unknown, source?: string): GraphSnapshot
function formatDiff(diff: GraphDiff): string
function formatSnapshotSummary(snapshot: GraphSnapshot): string
function writeSnapshot(graph: CircuitGraph, outputPath: string, captureContext?: Record<string, any>): GraphSnapshot
```

### Snapshot Format

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-04T00:00:00.000Z",
  "currentTick": 12,
  "captureContext": { "harness": "checkout-flow" },
  "nodes": [
    { "id": "count", "runtimeId": "count_0", "stablePath": "count", "name": "count", "type": "signal", "deps": [] },
    { "id": "doubled", "runtimeId": "doubled_1", "stablePath": "doubled", "name": "doubled", "type": "derived", "deps": ["count_0"], "depPaths": ["count"] }
  ],
  "edges": [
    { "from": "count", "to": "doubled" }
  ],
  "events": [],
  "waveforms": {},
  "operations": []
}
```
