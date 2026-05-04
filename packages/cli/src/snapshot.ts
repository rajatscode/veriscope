// snapshot.ts — Export a graph snapshot to a JSON file

import { writeFileSync } from 'node:fs';
import type { CircuitGraph } from '@veriscope/graph';

export function writeSnapshot(graph: CircuitGraph, outputPath: string): void {
  const snap = graph.snapshot();
  writeFileSync(outputPath, JSON.stringify(snap, null, 2), 'utf-8');
}
