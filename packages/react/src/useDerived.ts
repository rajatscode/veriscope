import { useMemo, useRef, useSyncExternalStore, useEffect } from 'react';
import { graph } from '@veriscope/graph';
import type { ReadonlySignal, Signal } from '@veriscope/graph';

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
): ReadonlySignal<T> {
  const nodeIdRef = useRef<string | null>(null);
  const prevRef = useRef<T | undefined>(undefined);
  const valueRef = useRef<T>(undefined as T);
  const subscribersRef = useRef(new Set<() => void>());

  // Register in graph once
  if (nodeIdRef.current === null) {
    nodeIdRef.current = graph.registerNode({
      name,
      type: 'derived',
      deps: deps.map(d => d.nodeId),
    });
    // Compute initial value
    valueRef.current = computeFn();
    prevRef.current = valueRef.current;
    graph.setNodeValue(nodeIdRef.current, () => valueRef.current);
  }

  const nodeId = nodeIdRef.current;

  // Recompute when deps change (read .val to get React to track re-renders)
  const depValues = deps.map(d => d.val);
  const newValue = useMemo(() => computeFn(), depValues);

  // Only notify graph on actual changes
  if (!Object.is(newValue, prevRef.current)) {
    const old = prevRef.current;
    prevRef.current = newValue;
    valueRef.current = newValue;
    graph.notifyChange(nodeId, old, newValue);
    // Notify external store subscribers
    for (const sub of subscribersRef.current) sub();
  } else {
    valueRef.current = newValue;
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (nodeIdRef.current) {
        graph.disposeNode(nodeIdRef.current);
      }
    };
  }, []);

  // Build stable signal object
  const signalRef = useRef<ReadonlySignal<T> | null>(null);
  if (signalRef.current === null) {
    const sig: any = { nodeId, name };
    Object.defineProperty(sig, 'val', {
      get() { return valueRef.current; },
      enumerable: true,
    });
    signalRef.current = sig as ReadonlySignal<T>;
  }

  return signalRef.current!;
}
