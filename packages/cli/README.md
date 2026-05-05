# @veriscope/cli

Command-line tool for validating and comparing Veriscope reactive graph snapshots.

## Installation

```bash
npm install @veriscope/cli
```

## Quick Example

```bash
# Compare two graph snapshot files
veriscope diff before.json after.json

# Validate a snapshot file
veriscope validate graph.json

# Output:
# Added nodes:
#   + newSignal
# Removed nodes:
#   - oldDerived
# Added edges:
#   + count → doubled
```

## Commands

### `veriscope diff <graph-a.json> <graph-b.json>`

Compares two graph snapshot JSON files and prints a human-readable summary of structural differences.

**Arguments:**

| Argument | Required | Description |
|---|---|---|
| `<graph-a.json>` | Yes | Path to the baseline graph snapshot JSON file |
| `<graph-b.json>` | Yes | Path to the updated graph snapshot JSON file |

**Output sections** (only printed when differences exist):

- **Added nodes** -- nodes present in B but not A, prefixed with `+`
- **Removed nodes** -- nodes present in A but not B, prefixed with `-`
- **Changed nodes** -- nodes whose type changed between A and B, shown as `~ id: typeBefore -> typeAfter`
- **Added edges** -- dependency edges present in B but not A, shown as `+ from -> to`
- **Removed edges** -- dependency edges present in A but not B, shown as `- from -> to`

If the two snapshots are identical, prints `No differences found.`

**Exit codes:**

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Missing required file path arguments |

**Example:**

```bash
veriscope diff v1-graph.json v2-graph.json
```

```
Removed nodes:
  - legacyTimer
Changed nodes:
  ~ counter: signal -> derived
Added edges:
  + input -> counter
```

### `veriscope validate <graph.json>`

Validates that a JSON file conforms to the Veriscope snapshot artifact schema and prints a short summary.

**Arguments:**

| Argument | Required | Description |
|---|---|---|
| `<graph.json>` | Yes | Path to the graph snapshot JSON file |

**Exit codes:**

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Missing file path or invalid snapshot schema |

**Example:**

```bash
veriscope validate ./my-graph.json
```

### Snapshot Capture

The CLI process cannot inspect a browser app's in-memory `CircuitGraph` by itself. Capture snapshots from the app or test harness that owns the graph:

```ts
import { writeSnapshot } from '@veriscope/cli';

writeSnapshot(graph, './my-graph.json', { harness: 'checkout-flow' });
```

### No command / unknown command

Running `veriscope` with no arguments prints usage help and exits with code 0. Running with an unrecognized command prints usage help and exits with code 1.

## Graph Snapshot Format

Snapshot JSON files conform to the `GraphSnapshot` interface from `@veriscope/graph`:

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-04T00:00:00.000Z",
  "currentTick": 12,
  "captureContext": { "harness": "checkout-flow" },
  "nodes": [
    { "id": "count", "runtimeId": "count_0", "stablePath": "count", "name": "count", "type": "signal", "deps": [] },
    { "id": "doubled", "runtimeId": "doubled_1", "stablePath": "doubled", "name": "doubled", "type": "derived", "deps": ["count_0"], "depPaths": ["count"] }
  ],
  "edges": [
    { "from": "count", "to": "doubled" }
  ],
  "events": [],
  "waveforms": {},
  "operations": []
}
```

Each node has:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Stable node identifier used in snapshot diffs |
| `runtimeId` | `string` | Runtime-local node id |
| `stablePath` | `string` | Stable path across executions |
| `name` | `string` | Human-readable node name |
| `type` | `string` | One of `signal`, `derived`, `effect`, `assertion` |
| `deps` | `string[]` | Runtime IDs of nodes this node depends on |
| `depPaths` | `string[]` | Stable paths of nodes this node depends on |

Each edge has:

| Field | Type | Description |
|---|---|---|
| `from` | `string` | Source node ID |
| `to` | `string` | Target node ID |

## Programmatic API

The CLI source modules are also importable:

### `diffSnapshots(pathA: string, pathB: string): GraphDiff`

Reads two snapshot JSON files from disk and returns a `GraphDiff` object.

### `loadSnapshot(path: string): GraphSnapshot`

Reads, parses, and validates a single snapshot JSON file.

### `formatDiff(diff: GraphDiff): string`

Formats a `GraphDiff` into the same human-readable string the CLI prints.

### `validateSnapshot(value: unknown, source?: string): GraphSnapshot`

Validates an in-memory value and returns it as a `GraphSnapshot`.

### `formatSnapshotSummary(snapshot: GraphSnapshot): string`

Formats a short schema/node/edge/event/waveform/operation summary.

### `writeSnapshot(graph: CircuitGraph, outputPath: string, captureContext?: Record<string, any>): GraphSnapshot`

Serializes a `CircuitGraph` instance to a JSON file using `graph.snapshot(captureContext)`.

## GraphDiff Structure

The `GraphDiff` object returned by `diffSnapshots`:

```ts
interface GraphDiff {
  addedNodes: string[];        // Node IDs added in B
  removedNodes: string[];      // Node IDs removed from A
  changedNodes: Array<{        // Nodes with modified properties
    id: string;
    before: any;
    after: any;
  }>;
  addedEdges: GraphEdge[];     // Edges added in B
  removedEdges: GraphEdge[];   // Edges removed from A
}
```
