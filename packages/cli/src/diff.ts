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
    if (typeof node.id !== 'string') {
      throw new Error(`${source} node[${idx}] is missing a stable string id`);
    }
    if (node.stablePath !== undefined && typeof node.stablePath !== 'string') {
      throw new Error(`${source} node[${idx}] stablePath must be a string`);
    }
    if (node.runtimeId !== undefined && typeof node.runtimeId !== 'string') {
      throw new Error(`${source} node[${idx}] runtimeId must be a string`);
    }
    if (typeof node.type !== 'string') {
      throw new Error(`${source} node[${idx}] is missing a string type`);
    }
    if (!Array.isArray(node.deps)) {
      throw new Error(`${source} node[${idx}] is missing a deps array`);
    }
    if (node.depPaths !== undefined && !Array.isArray(node.depPaths)) {
      throw new Error(`${source} node[${idx}] depPaths must be an array when present`);
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

  if (snapshot.events !== undefined) {
    if (!Array.isArray(snapshot.events)) {
      throw new Error(`${source} events must be an array when present`);
    }
    for (const [idx, event] of snapshot.events.entries()) {
      if (!event || typeof event !== 'object') {
        throw new Error(`${source} event[${idx}] is not an object`);
      }
      if (typeof event.type !== 'string') {
        throw new Error(`${source} event[${idx}] is missing a string type`);
      }
      if (typeof event.nodeId !== 'string') {
        throw new Error(`${source} event[${idx}] is missing a string nodeId`);
      }
      if (typeof event.tick !== 'number') {
        throw new Error(`${source} event[${idx}] is missing a numeric tick`);
      }
      if (event.seq !== undefined && typeof event.seq !== 'number') {
        throw new Error(`${source} event[${idx}] seq must be numeric`);
      }
    }
  }

  if (snapshot.operations !== undefined) {
    if (!Array.isArray(snapshot.operations)) {
      throw new Error(`${source} operations must be an array when present`);
    }
    for (const [idx, op] of snapshot.operations.entries()) {
      if (!op || typeof op !== 'object') {
        throw new Error(`${source} operation[${idx}] is not an object`);
      }
      if (typeof op.id !== 'string' || typeof op.name !== 'string' || typeof op.status !== 'string') {
        throw new Error(`${source} operation[${idx}] must have string id/name/status`);
      }
      if (typeof op.startedAtTick !== 'number') {
        throw new Error(`${source} operation[${idx}] is missing startedAtTick`);
      }
      if (!Array.isArray(op.events)) {
        throw new Error(`${source} operation[${idx}] is missing events array`);
      }
    }
  }

  if (snapshot.operationModels !== undefined) {
    if (!Array.isArray(snapshot.operationModels)) {
      throw new Error(`${source} operationModels must be an array when present`);
    }
    for (const [idx, model] of snapshot.operationModels.entries()) {
      if (!model || typeof model !== 'object') {
        throw new Error(`${source} operationModel[${idx}] is not an object`);
      }
      if (typeof model.id !== 'string' || typeof model.name !== 'string') {
        throw new Error(`${source} operationModel[${idx}] must have string id/name`);
      }
      if (!Array.isArray(model.outcomes)) {
        throw new Error(`${source} operationModel[${idx}] is missing outcomes array`);
      }
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
    `Operation models: ${snapshot.operationModels?.length ?? 0}`,
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
