import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CircuitGraph } from '@veriscope/graph';
import { diffSnapshots, formatDiff, formatSnapshotSummary, loadSnapshot, validateSnapshot, writeSnapshot } from '../api';

describe('CLI diff', () => {
  function makeTmpDir() {
    return mkdtempSync(join(tmpdir(), 'veriscope-cli-test-'));
  }

  it('diffs two snapshot files and detects added/removed nodes', () => {
    const tmp = makeTmpDir();
    try {
      const g1 = new CircuitGraph();
      g1.registerNode({ name: 'a', type: 'signal' });
      g1.registerNode({ name: 'b', type: 'derived' });

      const g2 = new CircuitGraph();
      g2.registerNode({ name: 'a', type: 'signal' });
      g2.registerNode({ name: 'c', type: 'effect' });

      const pathA = join(tmp, 'a.json');
      const pathB = join(tmp, 'b.json');
      writeFileSync(pathA, JSON.stringify(g1.snapshot()));
      writeFileSync(pathB, JSON.stringify(g2.snapshot()));

      const diff = diffSnapshots(pathA, pathB);
      expect(diff.addedNodes).toContain('c');
      expect(diff.removedNodes).toContain('b');
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it('detects added and removed edges', () => {
    const tmp = makeTmpDir();
    try {
      const g1 = new CircuitGraph();
      const a1 = g1.registerNode({ name: 'a', type: 'signal' });
      const b1 = g1.registerNode({ name: 'b', type: 'derived' });
      g1.addEdge(a1, b1);

      const g2 = new CircuitGraph();
      const a2 = g2.registerNode({ name: 'a', type: 'signal' });
      const b2 = g2.registerNode({ name: 'b', type: 'derived' });
      const c2 = g2.registerNode({ name: 'c', type: 'derived' });
      g2.addEdge(a2, c2);

      const pathA = join(tmp, 'a.json');
      const pathB = join(tmp, 'b.json');
      writeFileSync(pathA, JSON.stringify(g1.snapshot()));
      writeFileSync(pathB, JSON.stringify(g2.snapshot()));

      const diff = diffSnapshots(pathA, pathB);
      expect(diff.addedEdges.length).toBeGreaterThan(0);
      expect(diff.removedEdges.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it('reports no differences for identical snapshots', () => {
    const tmp = makeTmpDir();
    try {
      const g = new CircuitGraph();
      g.registerNode({ name: 'x', type: 'signal' });

      const path = join(tmp, 'same.json');
      writeFileSync(path, JSON.stringify(g.snapshot()));

      const diff = diffSnapshots(path, path);
      expect(diff.addedNodes).toHaveLength(0);
      expect(diff.removedNodes).toHaveLength(0);
      expect(diff.changedNodes).toHaveLength(0);
      expect(diff.addedEdges).toHaveLength(0);
      expect(diff.removedEdges).toHaveLength(0);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it('formatDiff produces human-readable output', () => {
    const g1 = new CircuitGraph();
    g1.registerNode({ name: 'a', type: 'signal' });

    const g2 = new CircuitGraph();
    g2.registerNode({ name: 'a', type: 'signal' });
    g2.registerNode({ name: 'b', type: 'derived' });

    const diff = CircuitGraph.diffGraphs(g1.snapshot(), g2.snapshot());
    const output = formatDiff(diff);
    expect(output).toContain('Added nodes:');
    expect(output).toContain('+ b');
  });

  it('formatDiff says no differences when empty', () => {
    const g = new CircuitGraph();
    g.registerNode({ name: 'x', type: 'signal' });
    const diff = CircuitGraph.diffGraphs(g.snapshot(), g.snapshot());
    const output = formatDiff(diff);
    expect(output).toContain('No differences');
  });

  it('validates snapshot schema before diffing', () => {
    expect(() => validateSnapshot({ nodes: [] })).toThrow(/edges array/);
    expect(() => validateSnapshot({ schemaVersion: 999, nodes: [], edges: [] })).toThrow(/unsupported schemaVersion/);
  });

  it('writes schema v1 snapshots with capture context', () => {
    const tmp = makeTmpDir();
    try {
      const g = new CircuitGraph();
      g.registerNode({ name: 'x', type: 'signal' });
      const path = join(tmp, 'nested', 'snapshot.json');

      const snapshot = writeSnapshot(g, path, { harness: 'unit' });
      const loaded = loadSnapshot(path);

      expect(snapshot.schemaVersion).toBe(1);
      expect(loaded.schemaVersion).toBe(1);
      expect(loaded.captureContext?.harness).toBe('unit');
      expect(formatSnapshotSummary(loaded)).toContain('Nodes: 1');
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });
});
