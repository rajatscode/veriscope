# @veriscope/test

Automated state-space exploration, assertion checking, and test utilities for `@veriscope/graph` reactive circuit graphs.

## Installation

```bash
npm install @veriscope/test
```

## Quick Example

```ts
import { CircuitGraph } from '@veriscope/graph';
import { explore } from '@veriscope/test';

const graph = new CircuitGraph();

// Register signals and assertions on the graph...

const result = await explore(graph, { budget: 500 });

console.log(`Steps: ${result.steps}`);
console.log(`Violations: ${result.violations.length}`);

for (const v of result.violations) {
  console.log(`${v.assertionName} violated at tick ${v.tick}`, v.signalValues);
}
```

## API Reference

### `explore(graph, options?)`

Main entry point. Explores the state space of a reactive graph by finding assertions, computing backward cones to identify relevant root signals, enumerating boolean combinations, resolving pending `eventually` assertions, running an adversarial pass to break assertions, and collecting coverage data.

```ts
function explore(
  graph: CircuitGraph,
  options?: ExploreOptions,
): Promise<ExploreResult>
```

**Parameters:**

- `graph` -- a `CircuitGraph` instance (from `@veriscope/graph`) with registered signals and assertions.
- `options` -- optional configuration (see `ExploreOptions` below).

**Behavior:**

1. Calls `graph.enterTestMode()`.
2. Discovers all assertions via `graph.getAssertions()`.
3. For each assertion, computes its backward cone of root signals.
4. If the cone contains 1--12 boolean-valued roots, enumerates all `2^n` input combinations, driving each through `graph.openTick()` / `graph.closeTick()` cycles and checking assertions after each.
5. Attempts to resolve pending `eventually` (`after`-kind) assertions by parsing check functions and driving signals toward satisfaction. Falls back to observational brute-force if parsing fails.
6. Runs an adversarial pass that analyzes assertion check functions and actively tries to break them (drives `always` assertions toward violation; triggers edges then prevents property satisfaction for `after` assertions).
7. Returns violations, coverage counters, and total steps consumed.

---

### `backwardCone(graph, targetNodeId)`

Finds all root signals (nodes with zero incoming edges) that affect a given node by walking the dependency graph backwards via BFS.

```ts
function backwardCone(
  graph: CircuitGraph,
  targetNodeId: string,
): string[]
```

**Parameters:**

- `graph` -- a `CircuitGraph` instance.
- `targetNodeId` -- the node ID to trace backwards from (typically an assertion node).

**Returns:** An array of node IDs representing the upstream root signals.

---

### `enumerateBooleanCombinations(signals, evaluate, flush)`

Generates all `2^n` boolean input combinations for the given signals, sets each combination, flushes, and evaluates a function to build a truth table.

```ts
function enumerateBooleanCombinations(
  signals: TruthTableSignal[],
  evaluate: () => any,
  flush: () => void,
): TruthTableRow[]
```

**Parameters:**

- `signals` -- array of `TruthTableSignal` objects, each with a `nodeId` and a `set(v: any) => void` function.
- `evaluate` -- function called after each combination is applied; its return value becomes the row's `output`.
- `flush` -- called after setting signal values and before evaluating, to allow the reactive graph to settle.

**Returns:** An array of `TruthTableRow` objects, one per combination.

---

### `traceReads(fn, signals)`

Intercepts `.val` property reads during execution of `fn` to discover which signals are actually read. Temporarily wraps `.val` getters, executes the function, then restores the original property descriptors.

```ts
function traceReads(
  fn: () => any,
  signals: Map<string, { val: any }>,
): { result: any; reads: string[] }
```

**Parameters:**

- `fn` -- the function to execute while tracing reads.
- `signals` -- a `Map` from signal ID to an object with a `.val` property.

**Returns:** An object with:
- `result` -- the return value of `fn`.
- `reads` -- array of signal IDs that were read during execution.

---

### `parseComputeFn(fn)`

Parses `fn.toString()` using Acorn to extract expression structure: which signals are read (via `.val` access), comparison operators and boundary values, and branch count (logical expressions).

```ts
function parseComputeFn(fn: () => any): ParsedExpression | null
```

**Parameters:**

- `fn` -- a function whose source code will be parsed. The function should reference signals via `signal.val` patterns.

**Returns:** A `ParsedExpression` object, or `null` if parsing fails.

---

### `shrinkSequence(sequence, replay)`

Attempts to shrink a violation's input sequence to a minimal reproduction using delta-debugging-style bisection. First tries removing halves, then individual steps, iterating until no further reduction is possible.

```ts
function shrinkSequence(
  sequence: ShrinkStep[],
  replay: (seq: ShrinkStep[]) => boolean,
): ShrinkStep[]
```

**Parameters:**

- `sequence` -- the original sequence of signal assignments that caused a violation.
- `replay` -- a function that replays a candidate sequence and returns `true` if the violation still occurs.

**Returns:** The minimal subsequence that still triggers the violation.

---

### `discoverMappings(graph, interactions, perform)`

Discovers which signals change when UI interactions occur. For each interaction, snapshots all signal values, performs the interaction via the `perform` callback, then diffs to find which signals changed.

```ts
function discoverMappings(
  graph: CircuitGraph,
  interactions: Array<{
    element: string;
    action: string;
    value?: string;
  }>,
  perform: (interaction: {
    element: string;
    action: string;
    value?: string;
  }) => void,
): InteractionMapping[]
```

**Parameters:**

- `graph` -- a `CircuitGraph` instance.
- `interactions` -- array of UI interactions to try, each with a CSS selector (`element`), an `action` string, and an optional `value`.
- `perform` -- callback that executes the given interaction (e.g., clicks a button, types into an input).

**Returns:** An array of `InteractionMapping` objects linking signal IDs to the interactions that caused them to change.

---

### `exploreViaInteractions(graph, mappings, perform, options?)`

Uses previously discovered `InteractionMapping`s to drive exploration through UI interactions instead of raw signal writes. Iterates through each mapping, performs the interaction, and checks assertions after each.

```ts
function exploreViaInteractions(
  graph: CircuitGraph,
  mappings: InteractionMapping[],
  perform: (trigger: InteractionMapping['trigger']) => void,
  options?: { budget?: number },
): void
```

**Parameters:**

- `graph` -- a `CircuitGraph` instance.
- `mappings` -- array of `InteractionMapping` objects (from `discoverMappings`).
- `perform` -- callback that executes the trigger (click, type, select).
- `options.budget` -- maximum number of interactions to perform. Default: `100`.

---

## Types

### `ExploreOptions`

```ts
interface ExploreOptions {
  /** Maximum number of exploration steps. Default: 1000. */
  budget?: number;
  /** Flush function for framework integration
      (React: () => act(() => {}), Solid: () => {}). */
  flush?: () => void | Promise<void>;
}
```

### `ExploreResult`

```ts
interface ExploreResult {
  violations: Violation[];
  coverage: {
    toggle: number;
    transitions: number;
    cross: number;
  };
  steps: number;
}
```

### `Violation`

```ts
interface Violation {
  assertionName: string;
  tick: number;
  signalValues: Record<string, any>;
  sequence: Array<{ signal: string; value: any }>;
}
```

### `ParsedExpression`

```ts
interface ParsedExpression {
  signals: string[];
  comparisons: Array<{
    signal: string;
    op: string;
    value: string;
  }>;
  branches?: number;
}
```

### `TruthTableSignal`

```ts
interface TruthTableSignal {
  nodeId: string;
  set: (v: any) => void;
}
```

### `TruthTableRow`

```ts
interface TruthTableRow {
  inputs: boolean[];
  output: any;
  reads: string[];
}
```

### `ShrinkStep`

```ts
interface ShrinkStep {
  signal: string;
  value: any;
}
```

### `InteractionMapping`

```ts
interface InteractionMapping {
  signalId: string;
  trigger: {
    element: string;       // CSS selector
    action: 'click' | 'type' | 'select';
    value?: string;
  };
}
```
