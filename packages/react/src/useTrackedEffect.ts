import { useEffect, useRef } from 'react';
import { graph } from '@veriscope/graph';
import type { Signal, ReadonlySignal } from '@veriscope/graph';

/**
 * Run a tracked side effect whenever any of the given signals change.
 * Registers the effect in the CircuitGraph with edges from each dependency.
 * The effect function can optionally return a cleanup function.
 */
export function useTrackedEffect(
  fn: () => void | (() => void),
  deps: Array<Signal<any> | ReadonlySignal<any>>,
  name: string,
): void {
  const nodeIdRef = useRef<string | null>(null);

  // Register in graph once
  if (nodeIdRef.current === null) {
    nodeIdRef.current = graph.registerNode({
      name,
      type: 'effect',
      deps: deps.map(d => d.nodeId),
    });
  }

  const nodeId = nodeIdRef.current;

  // Extract .val from each dep so React's useEffect tracks them
  const depValues = deps.map(d => d.val);

  useEffect(() => {
    graph.notifyEffect(nodeId);
    const cleanup = fn();
    return cleanup ?? undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, depValues);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (nodeIdRef.current) {
        graph.disposeNode(nodeIdRef.current);
      }
    };
  }, []);
}
