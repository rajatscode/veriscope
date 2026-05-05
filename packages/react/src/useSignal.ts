import { useState, useRef, useCallback, useEffect } from 'react';
import { graph as defaultGraph } from '@veriscope/graph';
import type { Signal, CircuitGraph } from '@veriscope/graph';

interface UseSignalOptions {
  states?: string[];
  stablePath?: string;
  scope?: string;
  graph?: CircuitGraph;
}

type SignalNext<T> = T | ((prev: T) => T);

function resolveNext<T>(old: T, next: SignalNext<T>): T {
  return typeof next === 'function' ? (next as (prev: T) => T)(old) : next;
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

  const applyNext = useCallback((next: SignalNext<T>) => {
    const old = valueRef.current;
    const nextValue = resolveNext(old, next);
    if (Object.is(old, nextValue)) return;
    valueRef.current = nextValue;
    setValue(nextValue);
  }, []);

  const set = useCallback((next: SignalNext<T>) => {
    const nodeId = nodeIdRef.current;
    if (!nodeId) {
      applyNext(next);
      return;
    }
    graphRef.current.driveNodeValue(nodeId, next);
  }, [applyNext]);

  // Register in graph once
  if (nodeIdRef.current === null) {
    const metadata: Record<string, any> = {};
    if (options?.states) metadata.states = options.states;
    if (options?.scope) metadata.scope = options.scope;
    nodeIdRef.current = graphRef.current.registerNode({
      name,
      type: 'signal',
      stablePath: options?.stablePath,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
    graphRef.current.setNodeValue(nodeIdRef.current, () => valueRef.current);
    graphRef.current.setNodeSetter(nodeIdRef.current, applyNext);
  }

  // Keep ref in sync
  valueRef.current = value;

  // Re-register if disposed (React StrictMode double-mount), cleanup on real unmount
  useEffect(() => {
    if (nodeIdRef.current && !graphRef.current.getNode(nodeIdRef.current)) {
      const metadata: Record<string, any> = {};
      if (options?.states) metadata.states = options.states;
      if (options?.scope) metadata.scope = options.scope;
      nodeIdRef.current = graphRef.current.registerNode({
        name,
        type: 'signal',
        stablePath: options?.stablePath,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
      graphRef.current.setNodeValue(nodeIdRef.current, () => valueRef.current);
      graphRef.current.setNodeSetter(nodeIdRef.current, applyNext);
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
