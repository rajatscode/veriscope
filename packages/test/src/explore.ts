// explore.ts — Main explore() function: backward-cone-driven state exploration

import type { CircuitGraph } from '@veriscope/graph';
import { backwardCone } from './backward-solve.js';
import { parseComputeFn } from './fn-parser.js';
import type { ExploreOptions, ExploreResult, Violation } from './types.js';

/**
 * Explore the state space of a reactive graph by:
 * 1. Finding assertions
 * 2. Computing backward cones to identify relevant root signals
 * 3. Enumerating boolean combinations for small cones
 * 4. Resolving pending eventually assertions
 * 5. Running adversarial pass to break assertions
 * 6. Collecting coverage data
 */
export async function explore(graph: CircuitGraph, options: ExploreOptions = {}): Promise<ExploreResult> {
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
        await flush();

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

        // 5. Check for pending eventually assertions and try to resolve them
        await resolveEventuallyAssertions(graph, assertions, rootNodes, flush);

        steps++;
      }
    } else if (boolRoots.length === 0) {
      // No boolean roots found — just check assertion at current state
      graph.openTick();
      await flush();
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

  // 6. Adversarial pass — try to break each assertion
  if (steps < budget) {
    const advViolations = await adversarialPass(graph, assertions, flush, budget - steps);
    violations.push(...advViolations.violations);
    steps += advViolations.steps;
  }

  return {
    violations,
    coverage: { toggle: 0, transitions: 0, cross: 0 },
    steps,
  };
}

// --- Eventually-resolution driver ---

/**
 * Detect pending 'eventually' assertions and try to drive their property to true.
 * Strategy:
 *   1. Parse the check function to find what signals need what values
 *   2. Drive signals directly based on parsed expression
 *   3. Fall back to observational: try each boolean value for each upstream signal
 */
async function resolveEventuallyAssertions(
  graph: CircuitGraph,
  assertions: Array<{ id: string; name: string; kind: string; checkFn: () => boolean; deps: string[] }>,
  rootNodes: Array<NonNullable<ReturnType<CircuitGraph['getNode']>>>,
  flush: () => void | Promise<void>,
): Promise<void> {
  const eventuallyAssertions = assertions.filter(a => a.kind === 'after');

  for (const assertion of eventuallyAssertions) {
    // Check if the assertion is pending (armed but not yet satisfied)
    // An 'after' assertion returns true vacuously when not armed, and true when still waiting.
    // We detect pending state by checking if the check passes AND if there was a recent armed event.
    if (assertion.checkFn()) {
      // Try to parse the check function and drive resolution
      const parsed = parseCheckFn(assertion.checkFn);

      if (parsed) {
        // Strategy 1: Drive signals based on parsed expression
        await driveFromParsed(graph, parsed, flush);
      } else {
        // Strategy 2: Observational — try boolean values for each upstream root
        await driveObservational(graph, rootNodes, assertion.checkFn, flush);
      }
    }
  }
}

interface ParsedCheck {
  negations: string[];   // signals that should be false: !signal.val
  affirmatives: string[]; // signals that should be truthy: signal.val
  disjuncts: string[][];  // groups of signals in OR: signal1.val || signal2.val
}

/**
 * Parse a check function's toString() to determine what signal values would satisfy it.
 */
function parseCheckFn(fn: () => boolean): ParsedCheck | null {
  try {
    const source = fn.toString();

    const negations: string[] = [];
    const affirmatives: string[] = [];
    const disjuncts: string[][] = [];

    // Match !signal.val patterns (negation — signal should be false to satisfy)
    for (const m of source.matchAll(/!(\w+)\.val\b/g)) {
      negations.push(m[1]);
    }

    // Match signal.val || signal.val patterns (disjunction)
    const disjunctMatch = source.match(/(\w+\.val)\s*\|\|\s*(\w+\.val)/g);
    if (disjunctMatch) {
      for (const d of disjunctMatch) {
        const signals = [...d.matchAll(/(\w+)\.val/g)].map(m => m[1]);
        disjuncts.push(signals);
      }
    }

    // Match standalone signal.val (affirmative, not preceded by !)
    for (const m of source.matchAll(/(?<![!\w])(\w+)\.val\b/g)) {
      if (!negations.includes(m[1])) {
        affirmatives.push(m[1]);
      }
    }

    if (negations.length === 0 && affirmatives.length === 0 && disjuncts.length === 0) {
      return null;
    }

    return { negations, affirmatives, disjuncts };
  } catch {
    return null;
  }
}

/**
 * Drive signals to values suggested by parsed expression analysis.
 */
async function driveFromParsed(
  graph: CircuitGraph,
  parsed: ParsedCheck,
  flush: () => void | Promise<void>,
): Promise<void> {
  const nodes = graph.getNodes();
  const nodeByName = new Map(nodes.map(n => [n.name, n]));

  graph.openTick();

  // Drive negations: set signal to false
  for (const name of parsed.negations) {
    const node = nodeByName.get(name);
    if (node?.setValue) {
      node.setValue(false);
    }
  }

  // Drive affirmatives: set signal to true
  for (const name of parsed.affirmatives) {
    const node = nodeByName.get(name);
    if (node?.setValue) {
      node.setValue(true);
    }
  }

  // Drive disjuncts: try each signal independently (set first one to true)
  for (const group of parsed.disjuncts) {
    for (const name of group) {
      const node = nodeByName.get(name);
      if (node?.setValue) {
        node.setValue(true);
        break; // only need one disjunct to be true
      }
    }
  }

  await flush();
  graph.checkAssertions();
  graph.closeTick();
}

/**
 * Observational fallback: try setting each upstream signal to each boolean value
 * until the property is satisfied.
 */
async function driveObservational(
  graph: CircuitGraph,
  rootNodes: Array<NonNullable<ReturnType<CircuitGraph['getNode']>>>,
  checkFn: () => boolean,
  flush: () => void | Promise<void>,
): Promise<void> {
  for (const node of rootNodes) {
    if (!node.setValue) continue;

    for (const val of [true, false]) {
      graph.openTick();
      node.setValue!(val);
      await flush();
      graph.checkAssertions();
      graph.closeTick();

      // Check if the assertion is now satisfied (checkFn returns true means either
      // not armed or property satisfied)
      if (checkFn()) return;
    }
  }
}

// --- Adversarial pass ---

interface AdversarialResult {
  violations: Violation[];
  steps: number;
}

/**
 * Adversarial pass: for each assertion, try to break it by driving inputs toward violation.
 *
 * - For assertAlways: parse check to find negation, drive toward it
 * - For assertAfter: trigger the edge, then try to prevent property satisfaction
 */
async function adversarialPass(
  graph: CircuitGraph,
  assertions: Array<{ id: string; name: string; kind: string; checkFn: () => boolean; deps: string[] }>,
  flush: () => void | Promise<void>,
  remainingBudget: number,
): Promise<AdversarialResult> {
  const violations: Violation[] = [];
  let steps = 0;
  const nodes = graph.getNodes();
  const nodeByName = new Map(nodes.map(n => [n.name, n]));

  for (const assertion of assertions) {
    if (steps >= remainingBudget) break;

    if (assertion.kind === 'always') {
      // Parse the check function to find what would violate it
      const parsed = parseComputeFn(assertion.checkFn);
      if (!parsed) continue;

      // Find signals in the assertion's backward cone
      const coneIds = backwardCone(graph, assertion.id);
      const coneNodes = coneIds
        .map(id => graph.getNode(id))
        .filter((n): n is NonNullable<typeof n> => n != null && n.setValue != null);

      // Try to drive toward violation: analyze the check function source
      const source = assertion.checkFn.toString();
      const targetValues = new Map<string, any>();

      // For !(a && b) style: try a=true, b=true (to break the assertion)
      const negAndMatch = source.match(/!\s*\(([^)]+)\)/);
      if (negAndMatch) {
        const inner = negAndMatch[1];
        for (const m of inner.matchAll(/(\w+)(?:\.val)?/g)) {
          const name = m[1];
          if (nodeByName.has(name)) {
            targetValues.set(name, true);
          }
        }
      }

      // For (a && !b) style: try to make a=true and b=false to satisfy the negation condition
      // Generic: parse all .val references and try each combination that would break it
      if (targetValues.size === 0) {
        // Fallback: try setting all signals in cone to true, then all to false
        for (const node of coneNodes) {
          targetValues.set(node.name, true);
        }
      }

      if (targetValues.size > 0) {
        graph.openTick();
        for (const [name, value] of targetValues) {
          const node = nodeByName.get(name);
          if (node?.setValue) {
            node.setValue(value);
          }
        }
        await flush();

        const v = graph.checkAssertions();
        graph.closeTick();
        steps++;

        if (v.length > 0) {
          for (const violation of v) {
            violations.push({
              assertionName: violation.name,
              tick: graph.currentTick,
              signalValues: Object.fromEntries(targetValues),
              sequence: [...targetValues.entries()].map(([signal, value]) => ({
                signal,
                value,
              })),
            });
          }
        }
      }
    } else if (assertion.kind === 'after') {
      // For assertAfter: trigger the edge, then try to prevent the property
      // The assertion depends on a trigger signal — find it in deps
      const depNodes = assertion.deps
        .map(id => graph.getNode(id))
        .filter((n): n is NonNullable<typeof n> => n != null && n.setValue != null);

      if (depNodes.length === 0) continue;

      // Trigger the edge: set the trigger signal to false then true (posedge)
      const triggerNode = depNodes[0];
      graph.openTick();
      triggerNode.setValue!(false);
      await flush();
      graph.checkAssertions();
      graph.closeTick();
      steps++;

      if (steps >= remainingBudget) break;

      graph.openTick();
      triggerNode.setValue!(true);
      await flush();
      graph.checkAssertions();
      graph.closeTick();
      steps++;

      if (steps >= remainingBudget) break;

      // Now try to prevent the property from being satisfied by
      // driving other signals to adversarial values
      const otherNodes = depNodes.slice(1);
      for (const node of otherNodes) {
        if (steps >= remainingBudget) break;
        for (const val of [true, false]) {
          if (steps >= remainingBudget) break;
          graph.openTick();
          node.setValue!(val);
          await flush();
          const v = graph.checkAssertions();
          graph.closeTick();
          steps++;

          if (v.length > 0) {
            for (const violation of v) {
              violations.push({
                assertionName: violation.name,
                tick: graph.currentTick,
                signalValues: { [triggerNode.name]: true, [node.name]: val },
                sequence: [
                  { signal: triggerNode.name, value: true },
                  { signal: node.name, value: val },
                ],
              });
            }
          }
        }
      }
    }
  }

  return { violations, steps };
}
