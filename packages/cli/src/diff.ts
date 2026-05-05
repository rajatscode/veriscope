// diff.ts — Read two JSON graph snapshots and diff them

import { readFileSync } from 'node:fs';
import { CircuitGraph } from '@veriscope/graph';
import type { GraphSnapshot, GraphDiff } from '@veriscope/graph';

export function loadSnapshot(path: string): GraphSnapshot {
  const raw = readFileSync(path, 'utf-8');
  return validateSnapshot(JSON.parse(raw), path);
}

export function validateSnapshot(value: unknown, source = 'snapshot'): GraphSnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error(`${source} is not a graph snapshot object`);
  }

  const snapshot = value as Partial<GraphSnapshot>;
  if (snapshot.schemaVersion !== undefined && snapshot.schemaVersion !== 1) {
    throw new Error(`${source} uses unsupported schemaVersion ${String(snapshot.schemaVersion)}`);
  }
  if (!Array.isArray(snapshot.nodes)) {
    throw new Error(`${source} is missing a nodes array`);
  }
  if (!Array.isArray(snapshot.edges)) {
    throw new Error(`${source} is missing an edges array`);
  }

  for (const [idx, node] of snapshot.nodes.entries()) {
    if (!node || typeof node !== 'object') {
      throw new Error(`${source} node[${idx}] is not an object`);
    }
    if (typeof node.name !== 'string') {
      throw new Error(`${source} node[${idx}] is missing a string name`);
    }
    if (typeof node.type !== 'string') {
      throw new Error(`${source} node[${idx}] is missing a string type`);
    }
    if (!Array.isArray(node.deps)) {
      throw new Error(`${source} node[${idx}] is missing a deps array`);
    }
  }

  for (const [idx, edge] of snapshot.edges.entries()) {
    if (!edge || typeof edge !== 'object') {
      throw new Error(`${source} edge[${idx}] is not an object`);
    }
    if (typeof edge.from !== 'string' || typeof edge.to !== 'string') {
      throw new Error(`${source} edge[${idx}] must have string from/to fields`);
    }
  }

  return snapshot as GraphSnapshot;
}

export function diffSnapshots(pathA: string, pathB: string): GraphDiff {
  const a = loadSnapshot(pathA);
  const b = loadSnapshot(pathB);
  return CircuitGraph.diffGraphs(a, b);
}

export function formatDiff(diff: GraphDiff): string {
  const lines: string[] = [];

  if (diff.addedNodes.length > 0) {
    lines.push('Added nodes:');
    for (const n of diff.addedNodes) lines.push(`  + ${n}`);
  }

  if (diff.removedNodes.length > 0) {
    lines.push('Removed nodes:');
    for (const n of diff.removedNodes) lines.push(`  - ${n}`);
  }

  if (diff.changedNodes.length > 0) {
    lines.push('Changed nodes:');
    for (const c of diff.changedNodes) {
      lines.push(`  ~ ${c.id}: ${c.before.type} → ${c.after.type}`);
    }
  }

  if (diff.addedEdges.length > 0) {
    lines.push('Added edges:');
    for (const e of diff.addedEdges) lines.push(`  + ${e.from} → ${e.to}`);
  }

  if (diff.removedEdges.length > 0) {
    lines.push('Removed edges:');
    for (const e of diff.removedEdges) lines.push(`  - ${e.from} → ${e.to}`);
  }

  if (lines.length === 0) {
    lines.push('No differences found.');
  }

  return lines.join('\n');
}

export function formatSnapshotSummary(snapshot: GraphSnapshot): string {
  const waveformCount = snapshot.waveforms ? Object.keys(snapshot.waveforms).length : 0;
  const lines = [
    `Veriscope snapshot schema v${snapshot.schemaVersion ?? 1}`,
    `Nodes: ${snapshot.nodes.length}`,
    `Edges: ${snapshot.edges.length}`,
    `Events: ${snapshot.events?.length ?? 0}`,
    `Waveforms: ${waveformCount}`,
    `Operations: ${snapshot.operations?.length ?? 0}`,
  ];

  if (snapshot.disposedNodes && snapshot.disposedNodes.length > 0) {
    lines.push(`Disposed nodes: ${snapshot.disposedNodes.length}`);
  }
  if (snapshot.currentTick !== undefined) {
    lines.push(`Current tick: ${snapshot.currentTick}`);
  }
  if (snapshot.capturedAt) {
    lines.push(`Captured at: ${snapshot.capturedAt}`);
  }

  return lines.join('\n');
}
