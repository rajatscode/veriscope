// snapshot.ts — Export a graph snapshot to a JSON file

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CircuitGraph } from '@veriscope/graph';
import type { GraphSnapshot } from '@veriscope/graph';
import { validateSnapshot } from './diff.js';

export function writeSnapshot(
  graph: CircuitGraph,
  outputPath: string,
  captureContext?: Record<string, any>,
): GraphSnapshot {
  const snap = validateSnapshot(graph.snapshot(captureContext), 'graph.snapshot()');
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(snap, null, 2), 'utf-8');
  return snap;
}
