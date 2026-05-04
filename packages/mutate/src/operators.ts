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
          if (!original) return () => {};
          g.setNodeValue(nodeId, () => constant);
          return () => g.setNodeValue(nodeId, original);
        },
      });
    }
  }

  return mutations;
}
