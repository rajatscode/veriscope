# Veriscope Fix Spec — Propagation Engine + Coverage Wiring

This is a concrete implementation plan for making the packages match `docs/SPEC.md`.
The VS Tetris example is only the review fixture; package internals are the product.

## Preserved Findings

The current implementation is not merely incomplete; several features are
misleading because they only work in narrow cases:

- `CircuitGraph` is passive today: it records topology and events, but setting a
  signal does not recompute downstream derived nodes.
- Existing tests can pass when assertions close over the same raw mutable values
  that `setValue` mutates. That does not prove graph execution works.
- `explore()` must propagate driven signal changes before checking assertions.
- Coverage cannot remain a hardcoded result. The graph already has a
  `notifyChange()` path that can record toggles when coverage is enabled, so the
  fix should wire exploration through that path instead of inventing a parallel
  counter.
- React hooks are not the first target for this fix. Browser adapters can keep
  settling through their framework runtime; this spec is about headless graph
  execution and the package tooling built on top of it.
- The `flush` callback in `explore()` still matters for browser-mode exploration
  and should stay.

## 1. Headless Graph Execution

`CircuitGraph` currently records topology and events, but it cannot recompute
derived nodes when test tooling drives a signal. That makes graph-driven
exploration hollow for any assertion that reads a derived value.

Add derived compute support to `@veriscope/graph`:

```ts
registerNode({
  name: 'canSubmit',
  type: 'derived',
  deps: [usernameId, loadingId],
  computeFn: () => username.length >= 3 && !loading,
});
```

Required behavior:

- store `computeFn` on derived graph nodes;
- maintain a current value for headless derived nodes;
- add `graph.propagate(fromNodeId?)`;
- after a signal is driven, topologically recompute downstream derived nodes;
- notify graph subscribers when a propagated derived value changes;
- emit `derived-recompute` events when derived values change;
- make `getValue()` return the latest propagated value;
- keep React/Solid adapter behavior intact, since adapters still settle through
  their framework runtime.

This is not a Comb-style scheduler. It is the minimal execution support needed
for headless graph tests and autotest tooling to have real derived semantics.

## 2. Real Coverage From Exploration

`explore()` must stop returning hardcoded coverage numbers.

Required behavior:

- reset or snapshot coverage at the start of an exploration run;
- enable coverage while exploration drives states;
- call `graph.propagate()` after each driven signal change;
- check assertions only after propagation and the caller-provided `flush`;
- return real coverage totals from `coverage.getReport()`;
- disable coverage on cleanup, including failure paths;
- include uncovered bins and denominators in the result.

Coverage is an autotest objective, not a passive afterthought. If exploration
does not reach a declared denominator, the result must say what is still
uncovered.

## 3. Autotest Runner

The library needs a first-class autotest runner, not a button that calls
`graph.checkAssertions()`.

Required inputs:

- graph roots with declared domains;
- assertions with declared dependency metadata;
- optional adapter action mappings for UI-level driving;
- optional external operation outcome domains;
- a settle/flush function from the framework adapter.

Required output:

- generated scenario traces;
- assertion pass/fail results;
- coverage hit/miss report;
- uncovered bins;
- shrunk failure traces where possible;
- waveform/tick context for failures.

Direct graph-root driving is acceptable for signal-level exploration. UI action
driving is required for claims about user workflows.

## 4. Mutation Runner

Current mutation behavior is not enough if it only applies a graph mutation and
checks the current assertion state.

Required behavior:

- generate behavior-relevant mutants;
- rerun generated and manual scenarios for each mutant;
- kill a mutant only when an assertion, coverage oracle, or scenario oracle
  detects a behavioral difference;
- classify invalid or equivalent mutants separately from survived mutants;
- report the scenario that killed each mutant.

Assertion-removal mutants should not be used to inflate mutation quality. They
may be useful as meta-tests, but they are not application behavior mutants.

## 5. Devtools Must Consume Package Artifacts

The package devtools should be the only devtools visible in VS Tetris. Demo-local
graph, coverage, autotest, or mutation panels must not fake product behavior.

The devtools product surface should converge on four tabs:

- Circuit
- Waveform
- Autotest
- Mutants

Circuit and Waveform must live-update from the graph/timeline artifact.
Autotest must combine assertion results with coverage progress. Mutants must run
through the same scenario runner used by Autotest.

## 6. Fragile Function Introspection

Parsing `fn.toString()` may remain as a development heuristic, but it must not be
the core product mechanism. Production-grade exploration needs declared domains,
declared dependencies, action mappings, and assertion metadata.

## 7. Acceptance Tests

Add package tests that fail against the current implementation and pass only
when the above behavior is real:

- `explore()` catches a derived-chain assertion by driving a root signal;
- `explore()` returns nonzero, real coverage when it drives covered states;
- uncovered denominators are reported explicitly;
- mutation runner kills a deliberately broken behavior by rerunning scenarios;
- Circuit devtools redraws on graph topology/value events;
- Waveform devtools records and toggles live signals;
- VS Tetris mounts package devtools only.

Minimum derived-chain regression:

```ts
const g = new CircuitGraph();
let a = false;

const aId = g.registerNode({ name: 'a', type: 'signal' });
g.setNodeValue(aId, () => a);
g.setNodeSetter(aId, (v) => {
  a = v;
});

const bId = g.registerNode({
  name: 'b',
  type: 'derived',
  deps: [aId],
  computeFn: () => !a,
});

const assertId = g.registerNode({ name: 'b-never-false', type: 'assertion' });
g.addEdge(bId, assertId);
g.setAssertionFn(assertId, () => g.getNode(bId)?.getValue?.(), 'always');

const result = await explore(g, { budget: 10 });
expect(result.violations.length).toBeGreaterThan(0);
```
