# @veriscope/react

React bindings for Veriscope -- hooks that create signals, derived computations, and effects that automatically register in a `CircuitGraph` for introspection, waveform recording, and assertion checking.

## Installation

```bash
npm install @veriscope/react @veriscope/graph
```

`react >= 18` is a required peer dependency.

## Quick Example

```tsx
import { useSignal, useDerived, useTrackedEffect } from '@veriscope/react';

function Counter() {
  const count = useSignal(0, 'count');
  const doubled = useDerived(() => count.val * 2, [count], 'doubled');

  useTrackedEffect(() => {
    console.log('doubled changed to', doubled.val);
  }, [doubled], 'log-doubled');

  return (
    <div>
      <p>{count.val} x 2 = {doubled.val}</p>
      <button onClick={() => count.set(count.val + 1)}>+1</button>
    </div>
  );
}
```

Every signal exposes `.val` for reads and `.set()` for writes. Reads are synchronous (backed by a ref), writes trigger a React state update and notify the graph.

## API Reference

### `useSignal<T>(initialValue, name, options?)`

Creates a mutable signal registered in the CircuitGraph.

```ts
function useSignal<T>(
  initialValue: T,
  name: string,
  options?: {
    states?: string[];
    graph?: CircuitGraph;
    stablePath?: string;
    scope?: string;
  },
): Signal<T>;
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `initialValue` | `T` | The initial value of the signal. |
| `name` | `string` | Human-readable name used in graph registration, waveform display, and diffs. |
| `options.states` | `string[]` | Optional finite state enumeration (e.g. `['idle', 'loading', 'done']`). Stored as node metadata for coverage collection. |
| `options.graph` | `CircuitGraph` | Optional graph instance. Defaults to the singleton `graph` from `@veriscope/graph`. |
| `options.stablePath` | `string` | Stable artifact identity for snapshots/diffs. |
| `options.scope` | `string` | Component/module scope metadata; used to derive stable paths when one is not supplied. |

**Returns:** `Signal<T>` -- an object with:

- `.val` -- getter that synchronously returns the current value (ref-backed, never stale).
- `.set(next: T | ((prev: T) => T))` -- sets a new value. Skips the update if `Object.is(old, next)` is true. Otherwise updates the ref, triggers a React state update, and calls `graph.notifyChange()`.
- `.nodeId` -- the graph node ID assigned at registration.
- `.name` -- the name string passed in.

**Lifecycle:** The graph node is registered once (during initial render) and disposed on unmount.

---

### `useDerived<T>(computeFn, deps, name, options?)`

Creates a read-only derived signal that recomputes when any dependency signal changes.

```ts
function useDerived<T>(
  computeFn: () => T,
  deps: Array<Signal<any> | ReadonlySignal<any>>,
  name: string,
  options?: {
    graph?: CircuitGraph;
    stablePath?: string;
    scope?: string;
  },
): ReadonlySignal<T>;
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `computeFn` | `() => T` | Pure function that computes the derived value. Called during render. |
| `deps` | `Array<Signal \| ReadonlySignal>` | Signals this derivation depends on. Their `.val` properties are read during render so React tracks re-renders, and their `.nodeId` values are registered as graph edges. |
| `name` | `string` | Human-readable name for graph registration. |
| `options.graph` | `CircuitGraph` | Optional graph instance. Defaults to the singleton. |
| `options.stablePath` | `string` | Stable artifact identity for snapshots/diffs. |
| `options.scope` | `string` | Component/module scope metadata. |

**Returns:** `ReadonlySignal<T>` -- an object with:

- `.val` -- getter returning the current derived value.
- `.nodeId` -- the graph node ID.
- `.name` -- the name string.

The graph is only notified (`notifyChange`) when the recomputed value is different from the previous one (`Object.is` comparison). The node is disposed on unmount.

---

### `useTrackedEffect(fn, deps, name, options?)`

Runs a side effect whenever any dependency signal changes, with the effect registered in the CircuitGraph.

```ts
function useTrackedEffect(
  fn: () => void | (() => void),
  deps: Array<Signal<any> | ReadonlySignal<any>>,
  name: string,
  options?: {
    graph?: CircuitGraph;
    stablePath?: string;
    scope?: string;
  },
): void;
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `() => void \| (() => void)` | Effect callback. May return a cleanup function (same contract as `useEffect`). |
| `deps` | `Array<Signal \| ReadonlySignal>` | Signals to track. Their `.val` values are used as the React effect dependency array. |
| `name` | `string` | Human-readable name for graph registration. |
| `options.graph` | `CircuitGraph` | Optional graph instance. Defaults to the singleton. |
| `options.stablePath` | `string` | Stable artifact identity for snapshots/diffs. |
| `options.scope` | `string` | Component/module scope metadata. |

Each time the effect fires, `graph.notifyEffect(nodeId)` is called, creating a waveform event. The node is disposed on unmount.

---

### `useEdgeEffect(signal, edge, action, name, options?)`

Fires an action on a boolean edge transition of a single signal -- inspired by hardware `posedge`/`negedge` semantics.

```ts
function useEdgeEffect(
  signal: Signal<any> | ReadonlySignal<any>,
  edge: 'posedge' | 'negedge',
  action: () => void,
  name: string,
  options?: {
    graph?: CircuitGraph;
    stablePath?: string;
    scope?: string;
  },
): void;
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `signal` | `Signal \| ReadonlySignal` | The signal to watch for edge transitions. |
| `edge` | `'posedge' \| 'negedge'` | `'posedge'` fires when the value transitions from falsy to truthy. `'negedge'` fires when the value transitions from truthy to falsy. |
| `action` | `() => void` | Callback invoked when the specified edge is detected. |
| `name` | `string` | Human-readable name for graph registration. |
| `options.graph` | `CircuitGraph` | Optional graph instance. Defaults to the singleton. |
| `options.stablePath` | `string` | Stable artifact identity for snapshots/diffs. |
| `options.scope` | `string` | Component/module scope metadata. |

The initial render is skipped -- only actual transitions fire the action. The node is disposed on unmount.

---

### Types (re-exported from `@veriscope/graph`)

```ts
interface Signal<T> extends ReadonlySignal<T> {
  set(next: T | ((prev: T) => T)): void;
}

interface ReadonlySignal<T> {
  readonly val: T;
  readonly nodeId: string;
  readonly name: string;
}
```

`CircuitGraph` is the class exported from `@veriscope/graph` that maintains the reactive dependency graph, records events, and supports snapshot/diff/assertion operations.

## Graph Injection for Testing

Every hook accepts an optional `graph` parameter via its options object. By default, all hooks register in the singleton `graph` instance exported from `@veriscope/graph`. In tests, you can inject an isolated graph to:

1. **Avoid cross-test pollution** -- each test gets its own graph.
2. **Inspect the graph** -- snapshot nodes/edges, verify wiring, check event history.
3. **Test assertions** -- arm graph-level assertions and verify they pass or fail.

```tsx
import { CircuitGraph } from '@veriscope/graph';
import { renderHook, act } from '@testing-library/react';
import { useSignal, useDerived } from '@veriscope/react';

test('derived tracks signal in isolated graph', () => {
  const testGraph = new CircuitGraph();

  const { result } = renderHook(() => {
    const count = useSignal(0, 'count', { graph: testGraph });
    const doubled = useDerived(() => count.val * 2, [count], 'doubled', { graph: testGraph });
    return { count, doubled };
  });

  expect(result.current.doubled.val).toBe(0);

  act(() => result.current.count.set(3));

  expect(result.current.doubled.val).toBe(6);

  // Inspect the graph
  const snap = testGraph.snapshot();
  expect(snap.nodes).toHaveLength(2);
  expect(snap.edges).toHaveLength(1);
});
```

This pattern makes `@veriscope/react` fully testable without mocking -- the graph is a plain object you create, pass in, and query.
