// operators.ts — Mutation operators for reactive graphs

import type { CircuitGraph } from '@veriscope/graph';
import type { Mutation } from './types.js';

/**
 * Generate all possible mutations for a reactive graph.
 * Three operator classes:
 * - sever-edge: break a dependency by replacing source with default value
 * - negate: flip a boolean signal
 * - constant-fold: replace a derived node with a constant
 */
export function generateMutations(graph: CircuitGraph): Mutation[] {
  const mutations: Mutation[] = [];
  const nodes = graph.getNodes();
  const edges = graph.getEdges();

  // Sever edge: for each edge, create a mutation that shadows the source
  for (const edge of edges) {
    const sourceNode = graph.getNode(edge.from);
    if (sourceNode?.getValue) {
      const sourceId = edge.from;
      const targetId = edge.to;
      mutations.push({
        name: `sever-edge:${sourceId}->${targetId}`,
        description: `Sever dependency from ${sourceNode.name} to ${graph.getNode(targetId)?.name ?? targetId}`,
        apply: (g) => {
          const node = g.getNode(sourceId);
          const original = node?.getValue;
          if (!original) return () => {};
          const currentVal = original();
          const defaultVal = typeof currentVal === 'boolean' ? false : 0;
          g.setNodeValue(sourceId, () => defaultVal);
          return () => g.setNodeValue(sourceId, original);
        },
      });
    }
  }

  // Negate boolean: for each boolean signal
  for (const node of nodes) {
    if (node.type === 'signal' && node.getValue) {
      const val = node.getValue();
      if (typeof val === 'boolean') {
        const nodeId = node.id;
        mutations.push({
          name: `negate:${nodeId}`,
          description: `Negate boolean signal ${node.name}`,
          apply: (g) => {
            const n = g.getNode(nodeId);
            const original = n?.getValue;
            if (!original) return () => {};
            g.setNodeValue(nodeId, () => !original());
            return () => g.setNodeValue(nodeId, original);
          },
        });
      }
    }
  }

  // Constant-fold derived: for each derived value
  for (const node of nodes) {
    if (node.type === 'derived' && node.getValue) {
      const val = node.getValue();
      const constant = typeof val === 'boolean' ? !val : 0;
      const nodeId = node.id;
      mutations.push({
        name: `constant-fold:${nodeId}`,
        description: `Replace ${node.name} with constant ${constant}`,
        apply: (g) => {
          const n = g.getNode(nodeId);
          const original = n?.getValue;
          const originalCompute = n?.computeFn;
          if (!original) return () => {};
          g.setNodeValue(nodeId, () => constant);
          if (n) {
            n.computeFn = () => constant;
            n.currentValue = constant;
            n.hasCurrentValue = true;
          }
          return () => {
            g.setNodeValue(nodeId, original);
            if (n) {
              n.computeFn = originalCompute;
              n.hasCurrentValue = false;
            }
          };
        },
      });
    }
  }

  // Swap edge: for each pair of same-type signals, make one read the other's value
  const signalNodes = nodes.filter(n => n.type === 'signal' && n.getValue);
  for (let i = 0; i < signalNodes.length; i++) {
    for (let j = i + 1; j < signalNodes.length; j++) {
      const a = signalNodes[i];
      const b = signalNodes[j];
      const aVal = a.getValue!();
      const bVal = b.getValue!();
      if (typeof aVal === typeof bVal) {
        const aId = a.id;
        const bId = b.id;
        mutations.push({
          name: `swap-edge:${aId}<->${bId}`,
          description: `Swap signal ${a.name} to read ${b.name}'s value`,
          apply: (g) => {
            const na = g.getNode(aId);
            const nb = g.getNode(bId);
            const originalA = na?.getValue;
            if (!originalA || !nb?.getValue) return () => {};
            const bGetter = nb.getValue!;
            g.setNodeValue(aId, bGetter);
            return () => g.setNodeValue(aId, originalA);
          },
        });
      }
    }
  }

  // Skip effect: for each effect node, wrap its action with a no-op
  for (const node of nodes) {
    if (node.type === 'effect') {
      const nodeId = node.id;
      mutations.push({
        name: `skip-effect:${nodeId}`,
        description: `Skip effect ${node.name} (replace with no-op)`,
        apply: (g) => {
          const n = g.getNode(nodeId);
          const original = n?.getValue;
          if (!original) return () => {};
          g.setNodeValue(nodeId, () => {});
          return () => g.setNodeValue(nodeId, original);
        },
      });
    }
  }

  // Invert comparison: for each derived node returning boolean, negate its compute
  for (const node of nodes) {
    if (node.type === 'derived' && node.getValue) {
      const val = node.getValue();
      if (typeof val === 'boolean') {
        const nodeId = node.id;
        mutations.push({
          name: `invert-comparison:${nodeId}`,
          description: `Invert boolean derived ${node.name}`,
        apply: (g) => {
          const n = g.getNode(nodeId);
          const original = n?.getValue;
          const originalCompute = n?.computeFn;
          if (!original) return () => {};
          g.setNodeValue(nodeId, () => !original());
          if (n) {
            n.computeFn = () => !original();
            n.hasCurrentValue = false;
          }
          return () => {
            g.setNodeValue(nodeId, original);
            if (n) {
              n.computeFn = originalCompute;
              n.hasCurrentValue = false;
            }
          };
        },
      });
      }
    }
  }

  // Remove assertion: for each assertion node, disable it
  for (const node of nodes) {
    if (node.type === 'assertion') {
      const nodeId = node.id;
      mutations.push({
        name: `remove-assertion:${nodeId}`,
        description: `Disable assertion ${node.name}`,
        apply: (g) => {
          const n = g.getNode(nodeId);
          const originalFn = n?.assertionFn;
          const originalKind = n?.assertionKind;
          if (!n || !originalFn) return () => {};
          // Disable by making it always pass
          g.setAssertionFn(nodeId, () => true, originalKind ?? 'always');
          return () => g.setAssertionFn(nodeId, originalFn, originalKind ?? 'always');
        },
      });
    }
  }

  // Delay effect: for each effect, queue its action to fire on next tick
  for (const node of nodes) {
    if (node.type === 'effect') {
      const nodeId = node.id;
      mutations.push({
        name: `delay-effect:${nodeId}`,
        description: `Delay effect ${node.name} to next tick`,
        apply: (g) => {
          const n = g.getNode(nodeId);
          const original = n?.getValue;
          if (!original) return () => {};
          g.setNodeValue(nodeId, () => {
            setTimeout(() => original(), 0);
          });
          return () => g.setNodeValue(nodeId, original);
        },
      });
    }
  }

  return mutations;
}
