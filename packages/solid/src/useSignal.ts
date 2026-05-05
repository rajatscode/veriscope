import { createSignal as solidCreateSignal, onCleanup } from 'solid-js';
import { graph as defaultGraph } from '@veriscope/graph';
import type { CircuitGraph, Signal } from '@veriscope/graph';

interface UseSignalOptions {
  states?: string[];
  graph?: CircuitGraph;
}

type SignalNext<T> = T | ((prev: T) => T);

function resolveNext<T>(old: T, next: SignalNext<T>): T {
  return typeof next === 'function' ? (next as (prev: T) => T)(old) : next;
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

  const applyNext = (next: SignalNext<T>) => {
    const old = value();
    const nextValue = resolveNext(old, next);
    if (Object.is(old, nextValue)) return;
    setValue(() => nextValue as any);
  };

  const signal: Signal<T> = {
    get val() { return value(); },
    set(next: SignalNext<T>) {
      g.openTick();
      g.driveNodeValue(nodeId, next);
    },
    nodeId,
    name,
  };

  g.setNodeSetter(nodeId, applyNext);
  onCleanup(() => g.disposeNode(nodeId));

  return signal;
}
