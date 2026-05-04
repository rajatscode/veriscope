// diff.ts — Read two JSON graph snapshots and diff them

import { readFileSync } from 'node:fs';
import { CircuitGraph } from '@veriscope/graph';
import type { GraphSnapshot, GraphDiff } from '@veriscope/graph';

export function loadSnapshot(path: string): GraphSnapshot {
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as GraphSnapshot;
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
