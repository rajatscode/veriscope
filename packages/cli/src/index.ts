#!/usr/bin/env node
// CLI entry point for veriscope

import { diffSnapshots, formatDiff } from './diff.js';

const args = process.argv.slice(2);
const command = args[0];

function usage(): void {
  console.log(`Usage:
  veriscope diff <graph-a.json> <graph-b.json>   Compare two graph snapshots
  veriscope snapshot -o <graph.json>              Write graph snapshot (placeholder)`);
}

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
} else if (command === 'snapshot') {
  const flagIdx = args.indexOf('-o');
  const outputPath = flagIdx !== -1 ? args[flagIdx + 1] : undefined;
  if (!outputPath) {
    console.error('Error: snapshot requires -o <output-path>');
    usage();
    process.exit(1);
  }
  // Placeholder: in real usage, the graph would be loaded from a running app
  console.log(`Snapshot placeholder: would write to ${outputPath}`);
} else {
  usage();
  process.exit(command ? 1 : 0);
}
