import { createMemo, onCleanup } from 'solid-js';
import { graph as defaultGraph } from '@veriscope/graph';
import type { CircuitGraph, ReadonlySignal, Signal } from '@veriscope/graph';

interface UseDerivedOptions {
  stablePath?: string;
  scope?: string;
  graph?: CircuitGraph;
}

/**
 * Create a derived (computed) signal that tracks dependencies and registers in the graph.
 * Wraps Solid's createMemo with graph instrumentation.
 */
export function useDerived<T>(
  fn: () => T,
  deps: Array<Signal<any> | ReadonlySignal<any>>,
  name: string,
  options?: UseDerivedOptions,
): ReadonlySignal<T> {
  const g = options?.graph ?? defaultGraph;
  let prev: T | undefined;
  let current = undefined as T;

  const computeForGraph = () => {
    const result = fn();
    current = result;
    prev = result;
    return result;
  };

  const nodeId = g.registerNode({
    name,
    type: 'derived',
    deps: deps.map(d => d.nodeId),
    stablePath: options?.stablePath,
    metadata: options?.scope ? { scope: options.scope } : undefined,
    computeFn: computeForGraph,
  });

  const memo = createMemo(() => {
    // Read all deps to establish Solid's tracking
    deps.forEach(d => d.val);
    const result = fn();
    if (!Object.is(result, prev)) {
      g.notifyChange(nodeId, prev, result);
      prev = result;
    }
    current = result;
    return result;
  });

  g.setNodeValue(nodeId, () => current);

  onCleanup(() => g.disposeNode(nodeId));

  return {
    get val() { return memo(); },
    nodeId,
    name,
  };
}
