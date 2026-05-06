import { useEffect, useRef } from 'react';
import { graph as defaultGraph } from '@veriscope/graph';
import type { Signal, ReadonlySignal, CircuitGraph } from '@veriscope/graph';

interface UseTrackedEffectOptions {
  stablePath?: string;
  scope?: string;
  graph?: CircuitGraph;
}

/**
 * Run a tracked side effect whenever any of the given signals change.
 * Registers the effect in the CircuitGraph with edges from each dependency.
 * The effect function can optionally return a cleanup function.
 */
export function useTrackedEffect(
  fn: () => void | (() => void),
  deps: Array<Signal<any> | ReadonlySignal<any>>,
  name: string,
  options?: UseTrackedEffectOptions,
): void {
  const g = options?.graph ?? defaultGraph;
  const nodeIdRef = useRef<string | null>(null);
  const graphRef = useRef(g);

  // Register in graph once
  if (nodeIdRef.current === null && graphRef.current.isInstrumentationEnabled()) {
    const metadata = options?.scope ? { scope: options.scope } : undefined;
    nodeIdRef.current = graphRef.current.registerNode({
      name,
      type: 'effect',
      deps: deps.map(d => d.nodeId),
      stablePath: options?.stablePath,
      metadata,
    });
  }

  // Extract .val from each dep so React's useEffect tracks them
  const depValues = deps.map(d => d.val);

  useEffect(() => {
    if (nodeIdRef.current && graphRef.current.isInstrumentationEnabled()) {
      graphRef.current.notifyEffect(nodeIdRef.current);
    }
    const cleanup = fn();
    return cleanup ?? undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, depValues);

  // Re-register if disposed (React StrictMode double-mount), cleanup on real unmount
  useEffect(() => {
    if (graphRef.current.isInstrumentationEnabled() && (!nodeIdRef.current || !graphRef.current.getNode(nodeIdRef.current))) {
      const metadata = options?.scope ? { scope: options.scope } : undefined;
      nodeIdRef.current = graphRef.current.registerNode({
        name,
        type: 'effect',
        deps: deps.map(d => d.nodeId),
        stablePath: options?.stablePath,
        metadata,
      });
    }
    return () => {
      if (nodeIdRef.current) {
        graphRef.current.disposeNode(nodeIdRef.current);
      }
    };
  }, []);
}
