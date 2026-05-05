import { createEffect, onCleanup } from 'solid-js';
import { graph as defaultGraph } from '@veriscope/graph';
import type { CircuitGraph, Signal, ReadonlySignal } from '@veriscope/graph';

interface UseTrackedEffectOptions {
  stablePath?: string;
  scope?: string;
  graph?: CircuitGraph;
}

/**
 * Run a tracked side effect whenever any of the given signals change.
 * Wraps Solid's createEffect with graph instrumentation.
 */
export function useTrackedEffect(
  fn: () => void | (() => void),
  deps: Array<Signal<any> | ReadonlySignal<any>>,
  name: string,
  options?: UseTrackedEffectOptions,
): void {
  const g = options?.graph ?? defaultGraph;

  const nodeId = g.registerNode({
    name,
    type: 'effect',
    deps: deps.map(d => d.nodeId),
    stablePath: options?.stablePath,
    metadata: options?.scope ? { scope: options.scope } : undefined,
  });

  let cleanup: (() => void) | void;

  createEffect(() => {
    // Read all deps to establish Solid's tracking
    deps.forEach(d => d.val);

    // Run previous cleanup
    if (typeof cleanup === 'function') cleanup();

    g.notifyEffect(nodeId);
    cleanup = fn();
  });

  onCleanup(() => {
    if (typeof cleanup === 'function') cleanup();
    g.disposeNode(nodeId);
  });
}
