# Veriscope Fix Spec — Propagation Engine + Coverage Wiring

This is an audited repair list for making the packages match `docs/SPEC.md`.
Treat each item as a claim to verify with a failing test before implementation.
The VS Tetris example is only the review fixture; package internals are the
product.

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
- Browser adapters can keep settling through their framework runtime, but they
  must register enough compute metadata for graph-driven tooling to observe and
  propagate real derived values.
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
- wire React/Solid derived hooks to register `computeFn` without replacing
  framework rendering.

This is not a Comb-style scheduler. It is the minimal execution support needed
for headless graph tests and autotest tooling to have real derived semantics.

## 2. Real Coverage From Exploration

`explore()` must stop returning hardcoded coverage numbers.

Required behavior:

- reset or snapshot coverage at the start of an exploration run;
- enable coverage while exploration drives states;
- drive changes through `graph.driveNodeValue()` so propagation and event
  bookkeeping run together;
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

Package-level mutation currently reruns `explore()`, which is the right shape but
inherits the weaknesses of `explore()`. Demo-local mutation panels that apply a
mutation and then call `graph.checkAssertions()` are not acceptable product
surfaces.

Required behavior:

- generate behavior-relevant mutants;
- rerun generated and manual scenarios for each mutant;
- kill a mutant only when an assertion, coverage oracle, or scenario oracle
  detects a behavioral difference;
- report selected-mode candidates with no path to a declared verification sink
  as unobserved/missing-oracle gaps, not survived mutants;
- classify invalid or equivalent mutants separately from survived mutants;
- report the scenario that killed each mutant.

Assertion-removal mutants should not be used to inflate mutation quality. They
may be useful as meta-tests, but they are not application behavior mutants.

## 5. Devtools Must Consume Package Artifacts

The package devtools should be the only devtools visible in VS Tetris. Demo-local
graph, coverage, autotest, or mutation panels must not fake product behavior.

The devtools product surface should keep live runtime monitoring separate from
generated tests:

- Circuit
- Waveform
- Live Assertions
- Autotest
- Mutants

Circuit and Waveform must live-update from the graph/timeline artifact.
Live Assertions must show only actual running graph events. Autotest must show
generated-case assertion results with live progress and coverage gaps. Mutants
must run through the same scenario runner used by Autotest.

Devtools need browser-level regression coverage. Canvas and DOM-heavy panels are
part of the product, so unit tests around pure helpers are not enough.

## 6. Fragile Function Introspection

Parsing `fn.toString()` may remain as a development heuristic, but it must not be
the core product mechanism. Production-grade exploration needs declared domains,
declared dependencies, action mappings, and assertion metadata.

Current implementation note: `explore()` now prefers declared assertion
`domains` for non-boolean root driving and only falls back to source parsing for
development heuristics.

## 7. Stable Artifact Identity And Snapshot Schema

`docs/SPEC.md` requires runtime IDs and stable paths. Current graph snapshots are
too thin if they only contain runtime-ish IDs, names, types, deps, and edges.

Required behavior:

- add explicit stable path support for graph nodes;
- include component/module scope metadata where adapters can provide it;
- avoid collapsing repeated component instances into the same diff identity;
- snapshot declared graph metadata, observed events, tick context, lifecycle
  markers, and capture harness context;
- make CLI snapshot/diff consume the same artifact schema used by devtools and
  tests.

The CLI must not advertise a meaningful snapshot command until it can produce
real scenario-relative artifacts.

## 8. Lifecycle And Waveform History

Disposal currently risks erasing important evidence. The product contract says
unmounted nodes leave an ended trace rather than silently disappearing.

Required behavior:

- `disposeNode()` removes active topology but preserves waveform/report history;
- record lifecycle events such as node-created and node-disposed;
- mark waveform traces ended at a tick/time;
- cancel or mark pending temporal assertions that cannot finish after disposal;
- release live coverage bookkeeping without deleting report history.

## 9. Tick And Adapter Settle Semantics

Ticks are supposed to represent synchronous UI causality. The current graph has
microtask-ish tick closing, but the full adapter contract is not implemented.

Required behavior:

- add explicit `batch` or `runInTick` support;
- ensure assertions and coverage evaluate on tick close;
- expose deterministic flush APIs for tests;
- let adapters provide their own settle barrier, e.g. React `act()`;
- ensure async continuations start new ticks;
- link tracked external operation events across ticks instead of merging them.

This remains weaker than Comb scheduling; it records framework behavior rather
than replacing the framework scheduler.

Current implementation note: `CircuitGraph.runInTick()` and `batch()` now close
the initiating tick before any returned promise continuation runs, and
`flushTick(settle?)` accepts a deterministic settle callback. Adapter-specific
settle wrappers still need to call these APIs consistently.

## 10. External Operation Spans

External request/response flows are central to the spec and are mostly missing
from this fix list unless called out explicitly.

Required behavior:

- add operation lifecycle APIs such as begin, resolve, reject, abort, timeout,
  stale, and with-operation context;
- record request events in the initiating tick;
- record response/error/abort/timeout handling in later linked ticks;
- allow operation outcome domains for exploration;
- add operation outcome coverage;
- surface operation spans in devtools and failure traces;
- support assertions over request/response ordering, stale responses, aborts,
  timeouts, and response-side state updates.

Veriscope should verify UI handling of external operations, not remote server
correctness.

Current implementation note: operation lifecycle APIs, operation models,
outcome coverage, Autotest operation-outcome scenarios, operation event
observations, and basic operation assertions (`assertOperationStatus`,
`assertNoStaleOperations`) are implemented. Richer request/response ordering
assertion helpers can still be added on top of the span/event model.

## 11. Signal API Parity

The spec's signal shape allows updater functions. Adapters and core types should
match that contract.

Required behavior:

- `Signal<T>.set` accepts `T | ((prev: T) => T)`;
- React and Solid adapters implement updater semantics consistently;
- graph setters used by exploration can drive either concrete values or updater
  functions without bypassing event/tick bookkeeping.

## 12. Assertion Metadata

Bare closure assertions are only live monitors. Explorable assertions need
metadata that the explorer can trust without parsing function source.

Required behavior:

- distinguish trigger dependencies from property/check dependencies;
- attach declared domains or operation outcome domains to dependencies;
- expose assertion coverage, including which assertions were exercised;
- report when an assertion lacks enough metadata for full exploration coverage;
- support future operation assertions over external spans.

## 13. Acceptance Tests

Add package tests that fail against the current implementation and pass only
when the above behavior is real:

- `explore()` catches a derived-chain assertion by driving a root signal;
- `explore()` returns nonzero, real coverage when it drives covered states;
- uncovered denominators are reported explicitly;
- mutation runner kills a deliberately broken behavior by rerunning scenarios;
- Circuit devtools redraws on graph topology/value events;
- Waveform devtools records and toggles live signals;
- VS Tetris mounts package devtools only;
- repeated component instances get distinct stable paths in snapshots;
- disposing a node preserves waveform history with an end marker;
- updater-form signal setters notify the graph correctly;
- CLI diff/validate consume the shared artifact schema, standalone snapshot
  refuses without a capture harness, and programmatic `writeSnapshot()` writes
  the shared schema;
- external operation spans link request and response ticks;
- operation outcome coverage reports explicit denominators;
- assertions without explorable metadata are labeled as partial coverage;
- devtools browser tests prove graph, waveform, autotest, and mutants render and
  update from package artifacts;
- the Vitest plugin is tested through a real Vitest run, not only by directly
  calling reporter hooks.

Current implementation note: the Vitest reporter supports `inputFiles` because
Vitest reporters run outside test workers. Worker tests can write reports with
`saveCoverageToFile()`, and the reporter merges those files on `onTestRunEnd`.

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
