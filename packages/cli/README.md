# @veriscope/cli

Command-line tool for comparing and exporting Veriscope reactive graph snapshots.

## Installation

```bash
npm install @veriscope/cli
```

## Quick Example

```bash
# Compare two graph snapshot files
veriscope diff before.json after.json

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

### `veriscope snapshot -o <output-path>`

Writes a graph snapshot to a JSON file. This command is currently a placeholder -- in production use, the graph would be captured from a running application.

**Flags:**

| Flag | Required | Description |
|---|---|---|
| `-o <output-path>` | Yes | File path where the snapshot JSON will be written |

**Exit codes:**

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Missing `-o` flag or output path |

**Example:**

```bash
veriscope snapshot -o ./my-graph.json
```

### No command / unknown command

Running `veriscope` with no arguments prints usage help and exits with code 0. Running with an unrecognized command prints usage help and exits with code 1.

## Graph Snapshot Format

Snapshot JSON files conform to the `GraphSnapshot` interface from `@veriscope/graph`:

```json
{
  "nodes": [
    { "id": "0", "name": "count", "type": "signal", "deps": [] },
    { "id": "1", "name": "doubled", "type": "derived", "deps": ["0"] }
  ],
  "edges": [
    { "from": "0", "to": "1" }
  ]
}
```

Each node has:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique node identifier |
| `name` | `string` | Human-readable node name |
| `type` | `string` | One of `signal`, `derived`, `effect`, `assertion` |
| `deps` | `string[]` | IDs of nodes this node depends on |

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

Reads and parses a single snapshot JSON file.

### `formatDiff(diff: GraphDiff): string`

Formats a `GraphDiff` into the same human-readable string the CLI prints.

### `writeSnapshot(graph: CircuitGraph, outputPath: string): void`

Serializes a `CircuitGraph` instance to a JSON file using `graph.snapshot()`.

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
