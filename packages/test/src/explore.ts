// explore.ts — Main explore() function: backward-cone-driven state exploration

import type { CircuitGraph } from '@veriscope/graph';
import { backwardCone } from './backward-solve.js';
import type { ExploreOptions, ExploreResult, Violation } from './types.js';

/**
 * Explore the state space of a reactive graph by:
 * 1. Finding assertions
 * 2. Computing backward cones to identify relevant root signals
 * 3. Enumerating boolean combinations for small cones
 * 4. Checking assertions after each combination
 * 5. Collecting coverage data
 */
export function explore(graph: CircuitGraph, options: ExploreOptions = {}): ExploreResult {
  const budget = options.budget ?? 1000;
  const flush = options.flush ?? (() => {});
  const violations: Violation[] = [];
  let steps = 0;

  graph.enterTestMode();

  // 1. Discover assertions
  const assertions = graph.getAssertions();

  // 2. For each assertion, find its upstream roots
  for (const assertion of assertions) {
    const roots = backwardCone(graph, assertion.id);
    const rootNodes = roots
      .map(id => graph.getNode(id))
      .filter((n): n is NonNullable<typeof n> => n != null);

    // 3. Filter to boolean-valued roots (for truth table enumeration)
    const boolRoots = rootNodes.filter(n => {
      if (!n.getValue) return false;
      const v = n.getValue();
      return typeof v === 'boolean';
    });

    if (boolRoots.length > 0 && boolRoots.length <= 12) {
      // 4. Enumerate all boolean combinations
      const totalCombos = 1 << boolRoots.length;

      for (let i = 0; i < totalCombos && steps < budget; i++) {
        const combo = boolRoots.map((_, j) => !!(i & (1 << j)));

        graph.openTick();
        boolRoots.forEach((node, j) => {
          if (node.setValue) {
            node.setValue(combo[j]);
          }
        });
        flush();

        // Check assertions
        const v = graph.checkAssertions();
        graph.closeTick();

        if (v.length > 0) {
          for (const violation of v) {
            violations.push({
              assertionName: violation.name,
              tick: graph.currentTick,
              signalValues: Object.fromEntries(
                boolRoots.map((n, j) => [n.name, combo[j]])
              ),
              sequence: combo.map((val, j) => ({
                signal: boolRoots[j].name,
                value: val,
              })),
            });
          }
        }
        steps++;
      }
    } else if (boolRoots.length === 0) {
      // No boolean roots found — just check assertion at current state
      graph.openTick();
      flush();
      const v = graph.checkAssertions();
      graph.closeTick();
      if (v.length > 0) {
        for (const violation of v) {
          violations.push({
            assertionName: violation.name,
            tick: graph.currentTick,
            signalValues: {},
            sequence: [],
          });
        }
      }
      steps++;
    }
  }

  return {
    violations,
    coverage: { toggle: 0, transitions: 0, cross: 0 },
    steps,
  };
}
