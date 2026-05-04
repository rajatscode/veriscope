// backward-solve.ts — Backward cone-of-influence analysis

import type { CircuitGraph } from '@veriscope/graph';

/**
 * Find all root signals (zero incoming edges) that affect the given node.
 * Walks edges backwards from target to roots using BFS.
 */
export function backwardCone(graph: CircuitGraph, targetNodeId: string): string[] {
  const visited = new Set<string>();
  const queue = [targetNodeId];
  const roots: string[] = [];
  const edges = graph.getEdges();

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const incoming = edges.filter(e => e.to === nodeId);
    if (incoming.length === 0 && nodeId !== targetNodeId) {
      roots.push(nodeId);
    } else if (incoming.length === 0 && nodeId === targetNodeId) {
      // target has no incoming edges — it is itself a root (unusual for assertions)
      // don't add to roots since we're looking for upstream signals
    } else {
      for (const edge of incoming) {
        queue.push(edge.from);
      }
    }
  }
  return roots;
}
