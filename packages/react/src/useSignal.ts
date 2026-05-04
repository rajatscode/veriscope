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
    graphRef.current.setNodeSetter(nodeIdRef.current, (next: T) => {
      const old = valueRef.current;
      if (Object.is(old, next)) return;
      valueRef.current = next;
      setValue(next);
      graphRef.current.notifyChange(nodeIdRef.current!, old, next);
    });
  }

  // Keep ref in sync
  valueRef.current = value;

  const set = useCallback((next: T) => {
    const old = valueRef.current;
    if (Object.is(old, next)) return;
    valueRef.current = next;
    setValue(next);
    graphRef.current.notifyChange(nodeIdRef.current!, old, next);
  }, []);

  // Re-register if disposed (React StrictMode double-mount), cleanup on real unmount
  useEffect(() => {
    if (nodeIdRef.current && !graphRef.current.getNode(nodeIdRef.current)) {
      const metadata: Record<string, any> = {};
      if (options?.states) metadata.states = options.states;
      nodeIdRef.current = graphRef.current.registerNode({
        name,
        type: 'signal',
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
      graphRef.current.setNodeValue(nodeIdRef.current, () => valueRef.current);
      graphRef.current.setNodeSetter(nodeIdRef.current, (next: T) => {
        const old = valueRef.current;
        if (Object.is(old, next)) return;
        valueRef.current = next;
        setValue(next);
        graphRef.current.notifyChange(nodeIdRef.current!, old, next);
      });
    }
    return () => {
      if (nodeIdRef.current) {
        graphRef.current.disposeNode(nodeIdRef.current);
      }
    };
  }, []);

  // Return a stable signal object with getter-based nodeId to track re-registrations
  const signalRef = useRef<Signal<T> | null>(null);
  if (signalRef.current === null) {
    const sig: any = { set, name };
    Object.defineProperty(sig, 'val', {
      get() { return valueRef.current; },
      enumerable: true,
    });
    Object.defineProperty(sig, 'nodeId', {
      get() { return nodeIdRef.current; },
      enumerable: true,
    });
    signalRef.current = sig as Signal<T>;
  }

  signalRef.current!.set = set;

  return signalRef.current!;
}
