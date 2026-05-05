# @veriscope/mutate

Mutation testing for reactive circuit graphs -- automatically injects faults into a `CircuitGraph` and measures how many mutations your assertions catch, producing a kill-rate score that quantifies assertion quality.

## Installation

```bash
npm install @veriscope/mutate
```

## Quick Example

```ts
import { mutate } from '@veriscope/mutate';
import { CircuitGraph } from '@veriscope/graph';

const factory = () => {
  const g = new CircuitGraph();
  let val = true;
  const a = g.registerNode({ name: 'a', type: 'signal' });
  g.setNodeValue(a, () => val);
  g.setNodeSetter(a, (v: boolean) => { val = v; });

  const assertId = g.registerNode({ name: 'a-must-be-true', type: 'assertion' });
  g.addEdge(a, assertId);
  g.setAssertionFn(assertId, () => val === true, 'always');

  return g;
};

const result = await mutate(factory, { budget: 200 });
console.log(`Score: ${result.score}/100  (${result.killed}/${result.total} killed)`);
console.log(`Autotest runs: ${result.autotestRuns}, steps: ${result.autotestSteps}`);
console.log('Survived:', result.survived);
```

## How It Works

1. A reference `CircuitGraph` is created from `factory` to enumerate all possible mutations via `generateMutations`.
2. For each mutation, a **fresh** graph is created (another `factory()` call), the mutation is applied, and the graph is explored using `@veriscope/test`'s `explore()` with the full configured per-mutant budget.
3. If exploration triggers any assertion violation, the mutation is **killed**. Otherwise it **survived**, indicating a gap in your assertions.
4. The final score is `(killed / total) * 100`.

## API Reference

### `mutate(factory, options?)`

```ts
function mutate(
  factory: () => CircuitGraph,
  options?: MutateOptions,
): Promise<MutateResult>
```

Run mutation testing on a reactive graph.

| Parameter | Type | Description |
|-----------|------|-------------|
| `factory` | `() => CircuitGraph` | Function that creates a fresh `CircuitGraph` for each mutation run. Called once to generate the mutation list, then once per mutation. |
| `options` | `MutateOptions` | Optional configuration (see below). |

Returns a `Promise<MutateResult>` with the aggregated results.

---

### `generateMutations(graph)`

```ts
function generateMutations(graph: CircuitGraph): Mutation[]
```

Generate all possible mutations for a reactive graph. Enumerates the graph's nodes and edges and returns a `Mutation[]` covering nine operator classes (see [Mutation Operators](#mutation-operators) below).

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `CircuitGraph` | The graph to analyze for possible mutations. |

---

### `MutateOptions`

```ts
interface MutateOptions {
  budget?: number;
  operators?: 'all' | string[];
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `budget` | `number` | `500` | Autotest exploration budget for each generated mutant. A run with 20 mutants and `budget: 500` may execute up to 20 full 500-step autotest explorations, with early completion when exploration exhausts reachable cases. |
| `operators` | `'all' \| string[]` | `'all'` | Which operator classes to apply. Pass `'all'` for every operator, or an array of operator name prefixes (e.g. `['negate', 'sever-edge']`) to restrict the set. |

---

### `MutateResult`

```ts
interface MutateResult {
  total: number;
  killed: number;
  survived: Array<{ mutation: string; description: string }>;
  score: number;
  budgetPerMutation: number;
  autotestRuns: number;
  autotestSteps: number;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `total` | `number` | Total number of mutations tested. |
| `killed` | `number` | Number of mutations detected by assertions. |
| `survived` | `Array<{ mutation: string; description: string }>` | List of mutations that were **not** caught. Each entry contains the mutation `name` (e.g. `"negate:nodeId"`) and a human-readable `description`. |
| `score` | `number` | Kill rate as a percentage (0--100). `100` means every mutation was caught. |
| `budgetPerMutation` | `number` | Autotest budget supplied to every mutated graph. |
| `autotestRuns` | `number` | Number of mutated graphs autotested. |
| `autotestSteps` | `number` | Sum of exploration steps reported by all mutant autotest runs. |

---

### `Mutation`

```ts
interface Mutation {
  name: string;
  description: string;
  apply: (graph: CircuitGraph) => () => void;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique identifier in the form `"operator:details"` (e.g. `"sever-edge:a->b"`, `"negate:flagId"`). |
| `description` | `string` | Human-readable explanation of what the mutation does. |
| `apply` | `(graph: CircuitGraph) => () => void` | Applies the mutation to a graph and returns an **undo** function that restores the original behavior. |

---

## Mutation Operators

`generateMutations` produces mutations from nine operator classes:

| Operator | Name prefix | Applies to | What it does |
|----------|------------|------------|--------------|
| **Sever edge** | `sever-edge` | Each edge whose source has a `getValue` | Replaces the source node's value with a default (`false` for booleans, `0` otherwise), breaking the dependency. |
| **Negate** | `negate` | Signal nodes with boolean values | Inverts the boolean signal (`true` becomes `false` and vice versa). |
| **Constant-fold** | `constant-fold` | Derived nodes with a `getValue` | Replaces the derived computation with a constant (inverted value for booleans, `0` for numbers). |
| **Swap edge** | `swap-edge` | Pairs of signal nodes with same-type values | Makes one signal read the other signal's value instead of its own. |
| **Skip effect** | `skip-effect` | Effect nodes | Replaces the effect's action with a no-op. |
| **Invert comparison** | `invert-comparison` | Derived nodes returning a boolean | Negates the derived node's boolean result. |
| **Remove assertion** | `remove-assertion` | Assertion nodes | Disables the assertion by making it always pass. |
| **Delay effect** | `delay-effect` | Effect nodes | Wraps the effect's action in `setTimeout(..., 0)`, deferring execution to the next tick. |

Each operator's `apply` function returns an undo callback, so mutations are fully reversible.

## Dependencies

- `@veriscope/graph` -- provides the `CircuitGraph` class
- `@veriscope/test` -- provides the `explore()` function used to exercise mutated graphs
