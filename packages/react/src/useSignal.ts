import { useState, useRef, useCallback, useEffect } from 'react';
import { graph as defaultGraph } from '@veriscope/graph';
import type { Signal, CircuitGraph } from '@veriscope/graph';

interface UseSignalOptions {
  states?: string[];
  graph?: CircuitGraph;
}

/**
 * Create a tracked signal that registers in the CircuitGraph.
 *
 * Uses a valueRef bridge pattern to avoid stale closures:
 * - React state drives re-renders
 * - A ref holds the current value for synchronous reads (`.val`)
 * - The graph tracks changes for waveform recording and assertions
 */
export function useSignal<T>(
  initialValue: T,
  name: string,
  options?: UseSignalOptions,
): Signal<T> {
  const g = options?.graph ?? defaultGraph;
  const [value, setValue] = useState(initialValue);
  const valueRef = useRef(initialValue);
  const nodeIdRef = useRef<string | null>(null);
  const graphRef = useRef(g);

  // Register in graph once
  if (nodeIdRef.current === null) {
    const metadata: Record<string, any> = {};
    if (options?.states) metadata.states = options.states;
    nodeIdRef.current = graphRef.current.registerNode({
      name,
      type: 'signal',
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
    graphRef.current.setNodeValue(nodeIdRef.current, () => valueRef.current);
  }

  const nodeId = nodeIdRef.current;

  // Keep ref in sync
  valueRef.current = value;

  const set = useCallback((next: T) => {
    const old = valueRef.current;
    if (Object.is(old, next)) return;
    valueRef.current = next;
    setValue(next);
    graphRef.current.notifyChange(nodeId, old, next);
  }, [nodeId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (nodeIdRef.current) {
        graphRef.current.disposeNode(nodeIdRef.current);
      }
    };
  }, []);

  // Return a stable signal object
  // We use Object.defineProperty for .val to always read from valueRef
  const signalRef = useRef<Signal<T> | null>(null);
  if (signalRef.current === null) {
    const sig: any = { set, nodeId, name };
    Object.defineProperty(sig, 'val', {
      get() { return valueRef.current; },
      enumerable: true,
    });
    signalRef.current = sig as Signal<T>;
  }

  // Update the set function on the signal if it changes (it shouldn't, since nodeId is stable)
  signalRef.current!.set = set;

  return signalRef.current!;
}
