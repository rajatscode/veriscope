import { createEffect, onCleanup } from 'solid-js';
import { graph as defaultGraph } from '@veriscope/graph';
import type { CircuitGraph, Signal, ReadonlySignal } from '@veriscope/graph';

interface UseEdgeEffectOptions {
  stablePath?: string;
  scope?: string;
  graph?: CircuitGraph;
}

/**
 * Fire an action on a signal edge transition (posedge or negedge).
 * Wraps Solid's createEffect with edge detection and graph instrumentation.
 *
 * - posedge: fires when the signal transitions from falsy to truthy
 * - negedge: fires when the signal transitions from truthy to falsy
 */
export function useEdgeEffect(
  signal: Signal<any> | ReadonlySignal<any>,
  edge: 'posedge' | 'negedge',
  action: () => void,
  name: string,
  options?: UseEdgeEffectOptions,
): void {
  const g = options?.graph ?? defaultGraph;

  const nodeId = g.registerNode({
    name,
    type: 'effect',
    deps: [signal.nodeId],
    stablePath: options?.stablePath,
    metadata: options?.scope ? { scope: options.scope } : undefined,
  });

  let prev: any = signal.val;
  let initialized = false;

  createEffect(() => {
    const current = signal.val;

    if (!initialized) {
      initialized = true;
      prev = current;
      return;
    }

    let edgeDetected = false;
    if (edge === 'posedge') {
      edgeDetected = !prev && !!current;
    } else {
      edgeDetected = !!prev && !current;
    }

    prev = current;

    if (edgeDetected) {
      g.notifyEffect(nodeId);
      action();
    }
  });

  onCleanup(() => g.disposeNode(nodeId));
}
