import { useEffect, useRef } from 'react';
import { graph } from '@veriscope/graph';
import type { Signal, ReadonlySignal } from '@veriscope/graph';

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
): void {
  const nodeIdRef = useRef<string | null>(null);
  const prevRef = useRef<any>(signal.val);
  const initializedRef = useRef(false);

  // Register in graph once
  if (nodeIdRef.current === null) {
    nodeIdRef.current = graph.registerNode({
      name,
      type: 'effect',
      deps: [signal.nodeId],
    });
  }

  const nodeId = nodeIdRef.current;
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
      graph.notifyEffect(nodeId);
      action();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVal]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (nodeIdRef.current) {
        graph.disposeNode(nodeIdRef.current);
      }
    };
  }, []);
}
