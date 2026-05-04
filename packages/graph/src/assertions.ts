// assertions.ts — Declarative assertions for reactive state invariants
// assertAlways: property must hold on every change
// assertNever: property must never hold
// assertAfter: after an edge, property must hold (immediately, eventually, or within N ticks)

import { graph, CircuitGraph } from './graph.js';
import type { Signal } from './types.js';

/**
 * Assert that a property holds at all times.
 * The check function is evaluated whenever checkAssertions() is called on the graph.
 * Returns the nodeId for the registered assertion node.
 */
export function assertAlways(
  checkFn: () => boolean,
  name: string,
  targetGraph: CircuitGraph = graph,
  deps?: Array<{ nodeId: string }>,
): string {
  const depIds = deps?.map(d => d.nodeId);
  const nodeId = targetGraph.registerNode({ name, type: 'assertion', deps: depIds });
  targetGraph.setAssertionFn(nodeId, checkFn, 'always');
  return nodeId;
}

/**
 * Assert that a property never holds.
 * Internally inverts the check and registers as an 'always' assertion.
 */
export function assertNever(
  checkFn: () => boolean,
  name: string,
  targetGraph: CircuitGraph = graph,
  deps?: Array<{ nodeId: string }>,
): string {
  return assertAlways(() => !checkFn(), name, targetGraph, deps);
}

interface AssertAfterOptions {
  name: string;
  edgeValue?: any;
  devWatchdogMs?: number;
}

/**
 * Assert that after a signal edge, a property holds.
 *
 * - 'immediately': checkFn must be true in the same tick as the edge
 * - 'eventually': checkFn must become true at some point (within watchdog timeout)
 * - { withinTicks: N }: checkFn must become true within N ticks of the edge
 *
 * This registers an assertion node and subscribes to graph events to detect edges.
 */
export function assertAfter(
  signal: { nodeId: string },
  edge: 'posedge' | 'negedge',
  operator: 'immediately' | 'eventually' | { withinTicks: number },
  checkFn: () => boolean,
  options: AssertAfterOptions,
  targetGraph: CircuitGraph = graph,
): string {
  const nodeId = targetGraph.registerNode({
    name: options.name,
    type: 'assertion',
    deps: [signal.nodeId],
  });

  let armed = false;
  let armedAtTick = 0;
  let previousValue: any = undefined;
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  // The assertion function for checkAssertions() to call
  const assertionCheck = (): boolean => {
    if (!armed) return true; // not armed = passes vacuously

    if (operator === 'immediately') {
      // Must hold right now
      const result = checkFn();
      if (result) {
        armed = false;
        targetGraph.notifyAssertionPassed(nodeId);
      }
      return result;
    }

    if (operator === 'eventually') {
      // Check if it holds now — if so, pass and disarm
      if (checkFn()) {
        armed = false;
        if (watchdogTimer) {
          clearTimeout(watchdogTimer);
          watchdogTimer = null;
        }
        targetGraph.notifyAssertionPassed(nodeId);
        return true;
      }
      // Still waiting — not a violation yet
      return true;
    }

    if (typeof operator === 'object' && 'withinTicks' in operator) {
      if (checkFn()) {
        armed = false;
        targetGraph.notifyAssertionPassed(nodeId);
        return true;
      }
      // Check if we've exceeded the tick budget
      const elapsed = targetGraph.currentTick - armedAtTick;
      if (elapsed >= operator.withinTicks) {
        armed = false;
        return false; // violation
      }
      return true; // still within budget
    }

    return true;
  };

  targetGraph.setAssertionFn(nodeId, assertionCheck, 'after');

  // Subscribe to graph events to detect the edge
  targetGraph.subscribe((event) => {
    if (event.nodeId !== signal.nodeId) return;
    if (event.type !== 'signal-change') return;

    const oldVal = event.oldValue;
    const newVal = event.newValue;

    let edgeDetected = false;
    if (edge === 'posedge') {
      // Transition from falsy to truthy (or from false to true for booleans)
      edgeDetected = !oldVal && !!newVal;
    } else {
      // Transition from truthy to falsy
      edgeDetected = !!oldVal && !newVal;
    }

    if (edgeDetected) {
      armed = true;
      armedAtTick = targetGraph.currentTick;
      targetGraph.notifyAssertionArmed(nodeId);

      // For 'eventually' with watchdog
      if (operator === 'eventually' && options.devWatchdogMs) {
        if (watchdogTimer) clearTimeout(watchdogTimer);
        watchdogTimer = setTimeout(() => {
          if (armed) {
            armed = false;
            targetGraph.notifyAssertionFailed(nodeId);
            console.warn(`[Veriscope] assertAfter watchdog expired: ${options.name}`);
          }
        }, options.devWatchdogMs);
      }
    }

    previousValue = newVal;
  });

  return nodeId;
}
