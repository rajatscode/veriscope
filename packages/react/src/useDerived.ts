import { useMemo, useRef, useSyncExternalStore, useEffect } from 'react';
import { graph as defaultGraph } from '@veriscope/graph';
import type { ReadonlySignal, Signal, CircuitGraph } from '@veriscope/graph';

interface UseDerivedOptions {
  graph?: CircuitGraph;
}

/**
 * Create a derived (computed) signal that tracks dependencies and registers in the graph.
 *
 * Re-derives when any dependency changes, but only notifies the graph on actual value changes.
 * Uses useSyncExternalStore for tear-free reads.
 */
export function useDerived<T>(
  computeFn: () => T,
  deps: Array<Signal<any> | ReadonlySignal<any>>,
  name: string,
  options?: UseDerivedOptions,
): ReadonlySignal<T> {
  const g = options?.graph ?? defaultGraph;
  const nodeIdRef = useRef<string | null>(null);
  const prevRef = useRef<T | undefined>(undefined);
  const valueRef = useRef<T>(undefined as T);
  const subscribersRef = useRef(new Set<() => void>());
  const graphRef = useRef(g);

  // Register in graph once
  if (nodeIdRef.current === null) {
    nodeIdRef.current = graphRef.current.registerNode({
      name,
      type: 'derived',
      deps: deps.map(d => d.nodeId),
    });
    // Compute initial value
    valueRef.current = computeFn();
    prevRef.current = valueRef.current;
    graphRef.current.setNodeValue(nodeIdRef.current, () => valueRef.current);
  }

  // Recompute when deps change (read .val to get React to track re-renders)
  const depValues = deps.map(d => d.val);
  const newValue = useMemo(() => computeFn(), depValues);

  // Only notify graph on actual changes
  if (!Object.is(newValue, prevRef.current)) {
    const old = prevRef.current;
    prevRef.current = newValue;
    valueRef.current = newValue;
    graphRef.current.notifyChange(nodeIdRef.current!, old, newValue);
    // Notify external store subscribers
    for (const sub of subscribersRef.current) sub();
  } else {
    valueRef.current = newValue;
  }

  // Re-register if disposed (React StrictMode double-mount), cleanup on real unmount
  useEffect(() => {
    if (nodeIdRef.current && !graphRef.current.getNode(nodeIdRef.current)) {
      nodeIdRef.current = graphRef.current.registerNode({
        name,
        type: 'derived',
        deps: deps.map(d => d.nodeId),
      });
      graphRef.current.setNodeValue(nodeIdRef.current, () => valueRef.current);
    }
    return () => {
      if (nodeIdRef.current) {
        graphRef.current.disposeNode(nodeIdRef.current);
      }
    };
  }, []);

  // Build stable signal object with getter-based nodeId to track re-registrations
  const signalRef = useRef<ReadonlySignal<T> | null>(null);
  if (signalRef.current === null) {
    const sig: any = { name };
    Object.defineProperty(sig, 'val', {
      get() { return valueRef.current; },
      enumerable: true,
    });
    Object.defineProperty(sig, 'nodeId', {
      get() { return nodeIdRef.current; },
      enumerable: true,
    });
    signalRef.current = sig as ReadonlySignal<T>;
  }

  return signalRef.current!;
}
