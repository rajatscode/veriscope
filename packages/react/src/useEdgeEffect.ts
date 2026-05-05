import { useEffect, useRef } from 'react';
import { graph as defaultGraph } from '@veriscope/graph';
import type { Signal, ReadonlySignal, CircuitGraph } from '@veriscope/graph';

interface UseEdgeEffectOptions {
  stablePath?: string;
  scope?: string;
  graph?: CircuitGraph;
}

/**
 * Fire an action on a signal edge transition (posedge or negedge).
 *
 * - posedge: fires when the signal transitions from falsy to truthy
 * - negedge: fires when the signal transitions from truthy to falsy
 *
 * Registers the effect in the CircuitGraph.
 */
export function useEdgeEffect(
  signal: Signal<any> | ReadonlySignal<any>,
  edge: 'posedge' | 'negedge',
  action: () => void,
  name: string,
  options?: UseEdgeEffectOptions,
): void {
  const g = options?.graph ?? defaultGraph;
  const nodeIdRef = useRef<string | null>(null);
  const prevRef = useRef<any>(signal.val);
  const initializedRef = useRef(false);
  const graphRef = useRef(g);

  // Register in graph once
  if (nodeIdRef.current === null) {
    const metadata = options?.scope ? { scope: options.scope } : undefined;
    nodeIdRef.current = graphRef.current.registerNode({
      name,
      type: 'effect',
      deps: [signal.nodeId],
      stablePath: options?.stablePath,
      metadata,
    });
  }

  const currentVal = signal.val;

  useEffect(() => {
    // Skip the initial render — we only care about transitions
    if (!initializedRef.current) {
      initializedRef.current = true;
      prevRef.current = currentVal;
      return;
    }

    const prev = prevRef.current;
    prevRef.current = currentVal;

    let edgeDetected = false;
    if (edge === 'posedge') {
      edgeDetected = !prev && !!currentVal;
    } else {
      edgeDetected = !!prev && !currentVal;
    }

    if (edgeDetected) {
      graphRef.current.notifyEffect(nodeIdRef.current!);
      action();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVal]);

  // Re-register if disposed (React StrictMode double-mount), cleanup on real unmount
  useEffect(() => {
    if (nodeIdRef.current && !graphRef.current.getNode(nodeIdRef.current)) {
      const metadata = options?.scope ? { scope: options.scope } : undefined;
      nodeIdRef.current = graphRef.current.registerNode({
        name,
        type: 'effect',
        deps: [signal.nodeId],
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
