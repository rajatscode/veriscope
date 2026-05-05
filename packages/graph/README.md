# @veriscope/graph

An introspectable reactive dependency graph with HDL-inspired assertions, waveform recording, coverage collection, and clock-domain crossing (CDC) analysis.

## Installation

```bash
npm install @veriscope/graph
```

## Quick Example

```ts
import { CircuitGraph, assertAlways, coverage } from '@veriscope/graph';

const g = new CircuitGraph();

// Register signals and derived nodes
const countId = g.registerNode({ name: 'count', type: 'signal' });
const doubleId = g.registerNode({ name: 'double', type: 'derived', deps: [countId] });

let countValue = 0;
let doubleValue = 0;
g.setNodeValue(countId, () => countValue);
g.setNodeSetter(countId, (v) => {
  const old = countValue;
  countValue = v;
  g.notifyChange(countId, old, v);
});
g.setNodeValue(doubleId, () => doubleValue);

// Add an invariant assertion
assertAlways(() => doubleValue === countValue * 2, 'double-invariant', g);

// Update state
g.openTick();
countValue = 5;
g.notifyChange(countId, 0, 5);
doubleValue = 10;
g.notifyChange(doubleId, 0, 10);
g.closeTick();

// Check all assertions — returns [] if everything holds
const violations = g.checkAssertions();
```

## API Reference

### Class: `CircuitGraph`

The core dependency graph. Manages nodes, edges, events, assertions, waveform recording, coverage integration, and CDC analysis.

A default singleton is exported as `graph`.

```ts
import { CircuitGraph, graph } from '@veriscope/graph';
```

#### Properties

##### `currentTick: number` (readonly)

The current simulation tick. Increments each time `closeTick()` is called.

#### Node Management

##### `registerNode(info): string`

Registers a node in the graph and returns its unique ID.

```ts
registerNode(info: {
  name: string;
  type: NodeType;          // 'signal' | 'derived' | 'effect' | 'assertion'
  deps?: string[];         // IDs of upstream dependencies
  stablePath?: string;     // stable identity for snapshots/diffs
  metadata?: Record<string, any>;
  assertionMetadata?: AssertionMetadata;
  computeFn?: () => any;   // headless derived recomputation
}): string
```

Edges from each dependency to the new node are added automatically. Derived nodes with `computeFn` can be recomputed by graph-driven tooling without replacing the framework runtime.

##### `addEdge(from: string, to: string): void`

Manually adds a directed edge between two nodes. Deduplicates — no-ops if the edge already exists.

##### `setNodeValue(id: string, getter: () => any): void`

Attaches a value getter to a node, used by waveform recording and external introspection.

##### `setNodeSetter(id: string, setter: (v: any) => void): void`

Attaches a value setter to a node, stored on `node.setValue`.

##### `driveNodeValue(id: string, value: any): void`

Sets a signal through its registered setter, emits a change event if the setter did not, and propagates downstream derived `computeFn` nodes in topological order.

##### `propagate(fromNodeId?: string): void`

Recomputes derived nodes downstream from `fromNodeId` (or all derived nodes when omitted) and emits `derived-recompute` events for changed values.

##### `setAssertionFn(id: string, fn: () => boolean, kind: 'always' | 'never' | 'after'): void`

Attaches an assertion check function and kind to an assertion node.

##### `disposeNode(id: string): void`

Removes a node and all edges connected to it. The disposed node and an ended waveform marker are preserved for snapshots and history.

#### Event Notifications

##### `notifyChange(nodeId: string, oldValue: any, newValue: any): void`

Records a value change event. Behavior:

- Pushes an event to the ring buffer (`signal-change`, `derived-recompute`, or `effect-run` based on node type).
- Records waveform data if recording is active.
- Tracks sync/async context for CDC analysis.
- Fires CDC warnings if an async-set signal feeds an unguarded derived node.
- Records toggle coverage for boolean values when coverage is enabled.
- Notifies all subscribers.
- Outside test mode, auto-manages tick open/close.

##### `notifyEffect(nodeId: string): void`

Records an `effect-run` event and notifies subscribers.

##### `notifyAssertionArmed(nodeId: string): void`

Records an `assertion-armed` event and notifies subscribers.

##### `notifyAssertionPassed(nodeId: string): void`

Records an `assertion-passed` event and notifies subscribers.

##### `notifyAssertionFailed(nodeId: string): void`

Records an `assertion-failed` event and notifies subscribers.

#### Queries

##### `getNodes(): GraphNode[]`

Returns a copy of all registered nodes.

##### `getEdges(): GraphEdge[]`

Returns a copy of all edges.

##### `getNode(id: string): GraphNode | undefined`

Returns a single node by ID.

##### `getAssertions(): Array<{ id: string; name: string; kind: string; checkFn: () => boolean; deps: string[] }>`

Returns all assertion nodes that have a check function attached.

##### `checkAssertions(): AssertionViolation[]`

Evaluates every registered assertion. Returns an array of violations (empty if all pass). Fires `assertion-passed` or `assertion-failed` events as a side effect.

##### `getRecentEvents(n?: number): GraphEvent[]`

Returns the most recent `n` events from the ring buffer (default 50, max 256).

#### Subscriptions

##### `subscribe(listener: (event: GraphEvent) => void): () => void`

Subscribes to all graph events. Returns an unsubscribe function.

#### Snapshots and Diffing

##### `snapshot(captureContext?: Record<string, any>): GraphSnapshot`

Captures a schema-versioned graph artifact with stable node paths, dependency paths, metadata, recent events, waveform history, disposed nodes, operation spans, operation models, and optional capture context.

##### `static diffGraphs(a: GraphSnapshot, b: GraphSnapshot): GraphDiff`

Compares two snapshots and returns structural differences: added/removed/changed nodes and added/removed edges. Comparison uses stable paths when present.

#### Tick Management

##### `enterTestMode(): void`

Enters test mode. In test mode, ticks do not auto-advance on `notifyChange` — you must call `openTick()`/`closeTick()` manually.

##### `openTick(): void`

Opens a new tick. Changes notified between `openTick()` and `closeTick()` share the same tick number.

##### `runInTick<T>(fn: () => T): T`

Runs synchronous work inside one explicit causality tick and closes that tick in a `finally` block. If `fn` returns a promise, the tick closes before awaited continuations run, so async follow-up work lands in later ticks.

##### `batch<T>(fn: () => T): T`

Alias for `runInTick()`.

##### `closeTick(): void`

Closes the current tick and increments `currentTick`.

##### `flushTick(settle?: () => void | Promise<void>): Promise<void>`

Closes the current tick, awaits a microtask, awaits an optional framework/test settle callback, then closes again so post-settle updates land in a deterministic tick.

##### `exitTestMode(): void`

Exits test mode. Ticks resume auto-advancing on each `notifyChange`.

#### Coverage Integration

##### `enableCoverage(): void`

Enables automatic toggle coverage recording for boolean signal changes. Also enables the global `CoverageCollector`.

##### `disableCoverage(): void`

Disables automatic coverage recording.

#### CDC (Clock-Domain Crossing) Analysis

##### `setAsyncContext(isAsync: boolean): void`

Marks subsequent signal writes as coming from an async context (e.g., fetch, setTimeout). Used by CDC analysis to detect unguarded async-to-sync crossings.

##### `getNodeLastSetContext(nodeId: string): 'sync' | 'async' | undefined`

Returns the context (`'sync'` or `'async'`) in which a signal was last set.

##### `onCdcWarning(listener: (warning: CdcWarning) => void): () => void`

Subscribes to CDC warnings. A warning fires when a signal set from an async context feeds a derived node that has no synchronous guard signal among its other dependencies. Returns an unsubscribe function.

#### External Operations

```ts
registerOperationModel(info: {
  name: string;
  outcomes: OperationStatus[];
  triggerDeps?: string[];
  outputDeps?: string[];
  metadata?: Record<string, any>;
  handleOutcome?: (outcome: OperationStatus, context: OperationModelContext) => void | Promise<void>;
}): string
beginOperation(name: string, metadata?: Record<string, any>): string
resolveOperation(id: string, value?: any): void
rejectOperation(id: string, error?: any): void
abortOperation(id: string, reason?: any): void
timeoutOperation(id: string): void
markOperationStale(id: string, newerId?: string): void
completeOperationOutcome(id: string, status: OperationStatus, payload?: any): void
withOperation<T>(id: string, fn: () => T): T
getOperations(): OperationSpan[]
getOperationModels(): OperationModel[]
```

Operation spans link request and response ticks without merging them. Events emitted inside `withOperation()` carry the active operation ID/name, and registered operation models provide outcome domains for autotest and coverage.

#### Waveform Recording

##### `startRecording(): void`

Starts recording waveform data. Takes an initial snapshot of all signal and derived node values, then appends timestamped samples on every `notifyChange`. Buffer limit: 2000 samples per node.

##### `stopRecording(): void`

Stops recording waveform data. Existing data is preserved.

##### `getWaveformData(): Map<string, Array<{ t: number; v: any }>>`

Returns a copy of all recorded waveform data, keyed by node ID.

#### Reset

##### `reset(): void`

 Clears all state: nodes, edges, events, listeners, waveforms, disposed node history, operation spans/models, tick counter, coverage, CDC state, and CDC warning listeners.

---

### Exported Singleton: `graph`

```ts
export const graph: CircuitGraph;
```

A default `CircuitGraph` instance for convenience. The assertion helper functions use it by default.

---

### Class: `CoverageCollector`

HDL-style coverage collection for measuring test completeness. Tracks:

- **Toggle** -- has every boolean signal been both `true` and `false`?
- **Transition** -- which FSM state transitions have been exercised?
- **Cross** -- which combinations of boolean signal values have been observed?
- **Operation outcomes** -- which declared external operation outcomes were observed?

A default singleton is exported as `coverage`.

```ts
import { CoverageCollector, coverage } from '@veriscope/graph';
```

##### `enable(): void`

Start collecting coverage data.

##### `disable(): void`

Stop collecting coverage data. Existing data is preserved.

##### `isEnabled(): boolean`

Returns `true` if coverage collection is active.

##### `recordToggle(signalId: string, value: boolean): void`

Records a boolean signal value for toggle coverage.

##### `recordTransition(fsmId: string, from: string, to: string): void`

Records an FSM state transition. Tracks all observed states and transition counts.

##### `declareTransitionStates(fsmId: string, states: string[]): void`

Declares the finite state domain used to report missing transition bins.

##### `registerCrossGroup(groupId: string, signalIds: string[]): void`

Registers a cross-coverage group. Must be called before `recordCross`. The `total` field is set to `2^n` for `n` signals.

##### `recordCross(groupId: string, values: boolean[]): void`

Records an observation of boolean signal values for a previously registered cross-coverage group.

##### `declareOperationOutcomes(operationName: string, outcomes: string[]): void`

Declares the finite outcome domain for an external operation.

##### `recordOperationOutcome(operationName: string, outcome: string): void`

Records an observed external operation outcome.

##### `getPreviousValue(signalId: string): any`

Returns the previously stored value of a signal (for transition detection).

##### `setPreviousValue(signalId: string, value: any): void`

Stores the current value of a signal for future transition detection.

##### `getReport(): CoverageReport`

Generates a coverage report with toggle, transition, cross, operation outcome, explicit gap data, and a summary with `totalPoints`, `coveredPoints`, and `percentage`.

##### `reset(): void`

Clears all collected coverage data.

---

### Assertion Functions

#### `assertAlways(checkFn, name, targetGraph?, deps?, metadata?): string`

Registers an assertion that must hold every time `checkAssertions()` is called. Returns the assertion node ID.

- `checkFn` -- returns `true` if the property holds.
- `name` -- human-readable assertion name.
- `targetGraph` -- defaults to the `graph` singleton.
- `deps` -- optional `{ nodeId }[]` dependency metadata for graph exploration.
- `metadata` -- optional domains, partial coverage status, and reason metadata.

#### `assertNever(checkFn, name, targetGraph?, deps?, metadata?): string`

Registers an assertion that must **never** hold. Internally inverts `checkFn` and delegates to `assertAlways`. Returns the assertion node ID.

#### `assertAfter(signal, edge, operator, checkFn, options, targetGraph?): string`

Registers a temporal assertion: after a signal edge, a property must hold.

```ts
assertAfter(
  signal: { nodeId: string },
  edge: 'posedge' | 'negedge',
  operator: 'immediately' | 'eventually' | { withinTicks: number },
  checkFn: () => boolean,
  options: {
    name: string;
    edgeValue?: any;
    devWatchdogMs?: number;
    checkDeps?: Array<{ nodeId: string }> | string[];
    domains?: Record<string, any[]>;
    operationDomains?: Record<string, string[]>;
    partial?: boolean;
    reason?: string;
  },
  targetGraph?: CircuitGraph,  // defaults to `graph` singleton
): string
```

- `'immediately'` -- `checkFn` must be true in the same tick as the edge.
- `'eventually'` -- `checkFn` must become true at some point. If `devWatchdogMs` is set, a timer fires a failure after that many milliseconds.
- `{ withinTicks: N }` -- `checkFn` must become true within `N` ticks of the edge.
- `checkDeps`, `domains`, and `operationDomains` tell autotest what property dependencies and domains are explorable without relying on source parsing.

Returns the assertion node ID.

#### `assertOperationStatus(operationName, allowedStatuses, name?, targetGraph?): string`

Registers an operation assertion that fails when any completed operation with the given name finishes with a status outside `allowedStatuses`.

#### `assertNoStaleOperations(operationName?, name?, targetGraph?): string`

Registers an operation assertion that fails when a matching operation is marked `stale`. If `operationName` is omitted, it applies to all operation names and is marked as partial metadata coverage.

---

### Types

#### `Signal<T>`

```ts
interface Signal<T> extends ReadonlySignal<T> {
  set(next: T | ((prev: T) => T)): void;
}
```

#### `ReadonlySignal<T>`

```ts
interface ReadonlySignal<T> {
  readonly val: T;
  readonly nodeId: string;
  readonly name: string;
}
```

#### `NodeType`

```ts
type NodeType = 'signal' | 'derived' | 'effect' | 'assertion';
```

#### `GraphNode`

```ts
interface GraphNode {
  id: string;
  stablePath: string;
  name: string;
  type: NodeType;
  deps: string[];
  getValue: (() => any) | null;
  setValue: ((v: any) => void) | null;
  computeFn?: () => any;
  currentValue?: any;
  assertionFn?: () => boolean;
  assertionKind?: 'always' | 'never' | 'after';
  assertionMetadata?: AssertionMetadata;
  metadata?: Record<string, any>;
  createdAtTick: number;
  disposedAtTick?: number;
  trigger?: { element: string; action: 'click' | 'type' | 'select'; value?: string };
}
```

#### `GraphEdge`

```ts
interface GraphEdge {
  from: string;
  to: string;
}
```

#### `GraphEvent`

```ts
interface GraphEvent {
  seq?: number;
  type: 'node-created' | 'node-disposed'
      | 'signal-change' | 'derived-recompute' | 'effect-run'
      | 'assertion-armed' | 'assertion-passed' | 'assertion-failed'
      | 'operation-begin' | 'operation-resolve' | 'operation-reject'
      | 'operation-abort' | 'operation-timeout' | 'operation-stale';
  nodeId: string;
  tick: number;
  stablePath?: string;
  oldValue?: any;
  newValue?: any;
  operationId?: string;
  operationName?: string;
  status?: OperationStatus;
}
```

#### `GraphSnapshot`

```ts
interface GraphSnapshot {
  schemaVersion?: 1;
  capturedAt?: string;
  currentTick?: number;
  captureContext?: Record<string, any>;
  nodes: Array<{
    id: string;
    runtimeId?: string;
    stablePath?: string;
    name: string;
    type: string;
    deps: string[];
    depPaths?: string[];
    metadata?: Record<string, any>;
    assertionMetadata?: AssertionMetadata;
  }>;
  edges: GraphEdge[];
  events?: GraphEvent[];
  waveforms?: Record<string, WaveformPoint[]>;
  disposedNodes?: GraphSnapshot['nodes'];
  operations?: OperationSpan[];
  operationModels?: OperationModel[];
}
```

#### `GraphDiff`

```ts
interface GraphDiff {
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: Array<{ id: string; before: any; after: any }>;
  addedEdges: GraphEdge[];
  removedEdges: GraphEdge[];
}
```

#### `AssertionViolation`

```ts
interface AssertionViolation {
  nodeId: string;
  name: string;
  kind: 'always' | 'never' | 'after';
  tick: number;
}
```

#### `CdcWarning`

```ts
interface CdcWarning {
  type: 'cdc-async-unguarded';
  signalId: string;
  signalName: string;
  derivedId: string;
  derivedName: string;
  tick: number;
}
```

#### `ToggleCoverage`

```ts
interface ToggleCoverage {
  signalId: string;
  seenTrue: boolean;
  seenFalse: boolean;
}
```

#### `TransitionCoverage`

```ts
interface TransitionCoverage {
  fsmId: string;
  transitions: Map<string, number>;  // "stateA->stateB" -> count
  states: Set<string>;
}
```

#### `CrossCoverage`

```ts
interface CrossCoverage {
  groupId: string;
  signals: string[];
  observed: Map<string, number>;  // "1,0,1" -> count
  total: number;                  // 2^n possible combos for n boolean signals
}
```

#### `CoverageReport`

```ts
interface CoverageReport {
  toggle: ToggleCoverage[];
  transitions: TransitionCoverage[];
  cross: CrossCoverage[];
  operations: OperationOutcomeCoverage[];
  gaps: CoverageGap[];
  summary: { totalPoints: number; coveredPoints: number; percentage: number };
}
```
