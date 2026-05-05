#!/usr/bin/env node
// CLI entry point for veriscope

import { diffSnapshots, formatDiff } from './diff.js';
import { formatSnapshotSummary, loadSnapshot } from './diff.js';

const args = process.argv.slice(2);
const command = args[0];

function usage(): void {
  console.log(`Usage:
  veriscope diff <graph-a.json> <graph-b.json>   Compare two graph snapshots
  veriscope validate <graph.json>                 Validate and summarize a graph snapshot

Snapshot capture is done from an app or test harness with writeSnapshot(graph, path).`);
}

try {
  if (command === 'diff') {
    const pathA = args[1];
    const pathB = args[2];
    if (!pathA || !pathB) {
      console.error('Error: diff requires two file paths');
      usage();
      process.exit(1);
    }
    const diff = diffSnapshots(pathA, pathB);
    console.log(formatDiff(diff));
  } else if (command === 'validate') {
    const path = args[1];
    if (!path) {
      console.error('Error: validate requires a snapshot file path');
      usage();
      process.exit(1);
    }
    console.log(formatSnapshotSummary(loadSnapshot(path)));
  } else if (command === 'snapshot') {
    console.error('Error: standalone snapshot capture requires a declared app/test capture harness.');
    console.error('Use writeSnapshot(graph, outputPath) from @veriscope/cli inside the process that owns the CircuitGraph.');
    process.exit(1);
  } else {
    usage();
    process.exit(command ? 1 : 0);
  }
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
