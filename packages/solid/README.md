# @veriscope/solid

Solid.js bindings for Veriscope's CircuitGraph -- reactive signals, derived computations, effects, and edge-triggered actions that automatically register in an introspectable dependency graph.

## Installation

```bash
npm install @veriscope/solid
```

Peer dependency: `solid-js >= 1.8`

## Quick Example

```tsx
import { useSignal, useDerived, useTrackedEffect, useEdgeEffect } from '@veriscope/solid';

function Counter() {
  const count = useSignal(0, 'count');
  const doubled = useDerived(() => count.val * 2, [count], 'doubled');

  useTrackedEffect(() => {
    console.log('doubled changed to', doubled.val);
  }, [doubled], 'log-doubled');

  const isPositive = useDerived(() => count.val > 0, [count], 'isPositive');
  useEdgeEffect(isPositive, 'posedge', () => {
    console.log('count became positive');
  }, 'became-positive');

  return (
    <div>
      <p>{count.val} x 2 = {doubled.val}</p>
      <button onClick={() => count.set(count.val + 1)}>+1</button>
      <button onClick={() => count.set(count.val - 1)}>-1</button>
    </div>
  );
}
```

## API Reference

All hooks accept an optional `options` object with a `graph` field plus `stablePath`/`scope` identity metadata. When omitted, the default singleton `CircuitGraph` from `@veriscope/graph` is used.

---

### `useSignal<T>(initial, name, options?)`

Create a tracked signal that registers in the CircuitGraph. Wraps Solid's `createSignal` with graph instrumentation.

```ts
function useSignal<T>(
  initial: T,
  name: string,
  options?: { states?: string[]; graph?: CircuitGraph; stablePath?: string; scope?: string },
): Signal<T>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `initial` | `T` | Initial value of the signal |
| `name` | `string` | Human-readable name shown in the graph and devtools |
| `options.states` | `string[]` | Optional enumerated state names (stored in graph node metadata) |
| `options.graph` | `CircuitGraph` | Optional graph instance (defaults to the global singleton) |
| `options.stablePath` | `string` | Stable artifact identity for snapshots/diffs |
| `options.scope` | `string` | Component/module scope metadata |

**Returns:** `Signal<T>` -- an object with:
- `val` (getter) -- reads the current value (triggers Solid's reactive tracking)
- `set(next: T | ((prev: T) => T))` -- updates the value; no-ops on `Object.is` equality; opens a graph tick and records the change
- `nodeId: string` -- the node's ID in the CircuitGraph
- `name: string` -- the node's name

The graph node is automatically disposed via `onCleanup` when the owning reactive scope is destroyed.

---

### `useDerived<T>(fn, deps, name, options?)`

Create a derived (computed) signal that re-evaluates when any dependency changes. Wraps Solid's `createMemo` with graph instrumentation.

```ts
function useDerived<T>(
  fn: () => T,
  deps: Array<Signal<any> | ReadonlySignal<any>>,
  name: string,
  options?: { graph?: CircuitGraph; stablePath?: string; scope?: string },
): ReadonlySignal<T>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `() => T` | Derivation function that computes the value |
| `deps` | `Array<Signal \| ReadonlySignal>` | Signals this derivation depends on (used for both Solid tracking and graph edge registration) |
| `name` | `string` | Human-readable name for the graph node |
| `options.graph` | `CircuitGraph` | Optional graph instance |
| `options.stablePath` | `string` | Stable artifact identity for snapshots/diffs |
| `options.scope` | `string` | Component/module scope metadata |

**Returns:** `ReadonlySignal<T>` -- an object with:
- `val` (getter) -- reads the current derived value (triggers Solid tracking via `createMemo`)
- `nodeId: string` -- the node's ID in the CircuitGraph
- `name: string` -- the node's name

The graph is only notified when the derived value actually changes (`Object.is` comparison). The graph node is disposed via `onCleanup`.

---

### `useTrackedEffect(fn, deps, name, options?)`

Run a side effect whenever any of the given signals change. Wraps Solid's `createEffect` with graph instrumentation.

```ts
function useTrackedEffect(
  fn: () => void | (() => void),
  deps: Array<Signal<any> | ReadonlySignal<any>>,
  name: string,
  options?: { graph?: CircuitGraph; stablePath?: string; scope?: string },
): void
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `() => void \| (() => void)` | Effect callback. May return a cleanup function that runs before the next execution and on disposal. |
| `deps` | `Array<Signal \| ReadonlySignal>` | Signals this effect depends on |
| `name` | `string` | Human-readable name for the graph node |
| `options.graph` | `CircuitGraph` | Optional graph instance |
| `options.stablePath` | `string` | Stable artifact identity for snapshots/diffs |
| `options.scope` | `string` | Component/module scope metadata |

**Returns:** `void`

The effect reads all `deps` to establish Solid's reactive tracking, then calls `fn`. If `fn` returns a function, it is used as a cleanup callback (runs before the next re-execution and on dispose). Each execution notifies the graph via `notifyEffect`. The graph node is disposed via `onCleanup`.

---

### `useEdgeEffect(signal, edge, action, name, options?)`

Fire an action on a boolean edge transition -- when a signal changes from falsy to truthy (`posedge`) or truthy to falsy (`negedge`). Wraps Solid's `createEffect` with edge detection and graph instrumentation.

```ts
function useEdgeEffect(
  signal: Signal<any> | ReadonlySignal<any>,
  edge: 'posedge' | 'negedge',
  action: () => void,
  name: string,
  options?: { graph?: CircuitGraph; stablePath?: string; scope?: string },
): void
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `signal` | `Signal \| ReadonlySignal` | The signal to monitor for edge transitions |
| `edge` | `'posedge' \| 'negedge'` | `posedge` fires on falsy-to-truthy; `negedge` fires on truthy-to-falsy |
| `action` | `() => void` | Callback invoked when the specified edge is detected |
| `name` | `string` | Human-readable name for the graph node |
| `options.graph` | `CircuitGraph` | Optional graph instance |
| `options.stablePath` | `string` | Stable artifact identity for snapshots/diffs |
| `options.scope` | `string` | Component/module scope metadata |

**Returns:** `void`

The first execution is skipped (initialization only -- it captures the initial value as `prev`). On subsequent changes, the previous and current values are compared to detect the requested edge. The graph is notified via `notifyEffect` only when the edge fires. The graph node is disposed via `onCleanup`.

---

### Re-exported Types (from `@veriscope/graph`)

The hooks use these types from `@veriscope/graph`:

```ts
interface ReadonlySignal<T> {
  readonly val: T;
  readonly nodeId: string;
  readonly name: string;
}

interface Signal<T> extends ReadonlySignal<T> {
  set(next: T | ((prev: T) => T)): void;
}
```

## Solid-Specific Behavior vs React Bindings

The `@veriscope/solid` and `@veriscope/react` packages expose identical APIs and semantics, but their internals differ to match each framework's reactivity model:

| Concern | `@veriscope/solid` | `@veriscope/react` |
|---------|--------------------|--------------------|
| Signal storage | Solid's `createSignal` | React `useState` + `useRef` bridge to avoid stale closures |
| Derived computation | Solid's `createMemo` (lazy, cached) | `useMemo` + `useSyncExternalStore` subscriber set for tear-free reads |
| Effect scheduling | Solid's `createEffect` (synchronous, fine-grained) | React `useEffect` (runs after paint, batched) |
| Cleanup / disposal | `onCleanup` (runs when the reactive owner is destroyed) | `useEffect` return cleanup (runs on unmount) |
| Re-render model | No re-renders; Solid updates DOM in place via fine-grained reactivity | Every signal `.set()` triggers a React re-render of the component |
| Object stability | Returned signal objects are plain objects (fresh each call is fine since Solid doesn't re-run component bodies) | `useRef` is needed to keep signal objects referentially stable across re-renders |
| Graph node registration | Runs inline on first call (component body runs once in Solid) | Uses `useRef` null-check pattern to run only once despite React re-renders |

In practice: Solid bindings are simpler because Solid's execution model (component body runs once, fine-grained updates thereafter) aligns naturally with the CircuitGraph's register-once-then-notify pattern. The React bindings require extra ref-based machinery to work around React's re-render-everything model.
