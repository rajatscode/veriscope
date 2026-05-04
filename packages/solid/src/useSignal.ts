import { createSignal as solidCreateSignal, onCleanup } from 'solid-js';
import { graph as defaultGraph } from '@veriscope/graph';
import type { CircuitGraph, Signal } from '@veriscope/graph';

interface UseSignalOptions {
  states?: string[];
  graph?: CircuitGraph;
}

/**
 * Create a tracked signal that registers in the CircuitGraph.
 * Wraps Solid's createSignal with graph instrumentation.
 */
export function useSignal<T>(
  initial: T,
  name: string,
  options?: UseSignalOptions,
): Signal<T> {
  const g = options?.graph ?? defaultGraph;

  const metadata: Record<string, any> = {};
  if (options?.states) metadata.states = options.states;

  const nodeId = g.registerNode({
    name,
    type: 'signal',
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  });

  const [value, setValue] = solidCreateSignal<T>(initial);

  g.setNodeValue(nodeId, value); // Solid's getter IS the getValue

  const signal: Signal<T> = {
    get val() { return value(); },
    set(next: T) {
      const old = value();
      if (Object.is(old, next)) return;
      g.openTick();
      setValue(() => next as any);
      g.notifyChange(nodeId, old, next);
    },
    nodeId,
    name,
  };

  g.setNodeSetter(nodeId, (v: any) => signal.set(v));
  onCleanup(() => g.disposeNode(nodeId));

  return signal;
}
