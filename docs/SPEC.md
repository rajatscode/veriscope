# Veriscope Product Spec

This document is the product contract for Veriscope. It defines what we are
building, what we are deliberately not building, and which guarantees the
packages should be held to.

## North Star

Veriscope helps developers build reactive UIs by writing executable
specifications instead of hand-written interaction tests wherever possible.

The goal is not to eliminate every test. The goal is to make assertions,
dependency graphs, timelines, exploration, coverage, and mutation feedback carry
as much of the UI verification burden as they reasonably can.

## Product Boundary

Veriscope is a TypeScript library suite for existing UI applications. It
provides:

- a stable graph artifact for signals, derived values, effects, assertions, and
  relevant external events;
- a timeline of value changes, effect runs, assertion results, coverage hits,
  and async boundaries;
- assertion primitives for invariants and temporal properties;
- exploration tools that use the graph to search meaningful UI states;
- coverage and mutation feedback for judging assertion quality;
- devtools and CLI surfaces that consume the same graph and timeline data.

Veriscope is not:

- the Comb language;
- a compiler for `.comb` files;
- a framework runtime;
- a delta-cycle or DES scheduler;
- a router, SSR system, DOM renderer, or component model;
- a promise that every arbitrary JavaScript value or side effect can be inferred
  without user or adapter discipline.

Comb remains a source of ideas, not the compatibility target.

## Graph Artifacts

Comb can emit a static graph because Comb owns the language and compiler.
Veriscope does not own the host framework or application compiler, so v1 should
not require a compiler-emitted graph.

Veriscope preserves the graph artifact concept in two layers:

- **Declared graph:** nodes and edges explicitly registered by framework
  adapters, helper APIs, assertions, and user annotations.
- **Observed graph:** runtime events recorded while the application runs,
  including value changes, effect runs, assertion checks, coverage hits, async
  boundaries, and external I/O observations.

The graph artifact must be serializable, diffable, and stable enough for CI.
Static analysis, Babel/SWC transforms, TypeScript plugins, or framework compiler
integrations may improve graph completeness later, but they are optional
extensions, not a v1 requirement.

Graph snapshots are scenario-relative. A snapshot represents the nodes, edges,
metadata, and events declared or observed by a capture harness while mounting and
exercising an application. It is not whole-program static truth unless a future
compiler or framework integration explicitly provides that stronger artifact.

The capture harness is therefore part of the artifact contract. CI graph diffs
must record enough context to explain what was mounted, which routes or fixtures
were used, which feature flags were active, and which exploration or interaction
steps were run.

## Discipline Model

Veriscope works when application code opts into observable primitives. Examples:

- use Veriscope-aware signals instead of opaque state for values that matter;
- declare dependencies for derived values, effects, assertions, and async work;
- name important nodes with stable, human-readable names;
- model meaningful external requests and responses through Veriscope APIs;
- keep imperative side effects behind tracked effects or tracked async helpers.

The discipline is part of the product. Hidden auto-instrumentation should not be
required for the core guarantees.

## Programming Model

Framework adapters should expose the same small shape wherever possible:

```ts
interface ReadonlySignal<T> {
  readonly val: T;
  readonly nodeId: string;
  readonly name: string;
}

interface Signal<T> extends ReadonlySignal<T> {
  set(next: T | ((prev: T) => T)): void;
}
```

The core tracked primitives are:

- signals: mutable graph roots or state holders;
- derived values: read-only values with declared dependencies;
- tracked effects: side effects with declared dependencies;
- edge effects: effects triggered by `posedge` or `negedge` transitions;
- assertions: executable properties over graph state, ticks, and operations.

The same signal object should serve two roles: application code reads `.val` and
writes with `.set()`, while Veriscope reads `nodeId`, `name`, metadata, and
dependency arrays to build the graph.

## Identity And Scope

Every graph node needs two identities:

- a runtime ID that is unique within one process execution;
- a stable path that is meaningful across executions and suitable for snapshots.

The stable path should include component or module scope when relevant. Duplicate
component instances must not collapse into one ambiguous name. Snapshot and diff
logic should prefer stable paths and use runtime IDs only for local bookkeeping.

Auto-generated instance suffixes are acceptable for local debugging, but they
are not enough for CI-stable diffs when mount order can change. Components,
routes, lists, and repeated subtrees need explicit scope or key support when
their topology is meant to be compared across runs.

## Lifecycle

Framework adapters must clean up graph state when tracked UI instances unmount or
tracked scopes end.

Disposal should:

- remove the node from the active graph topology;
- mark the waveform trace as ended rather than silently erasing its history;
- cancel or mark pending temporal assertions that can no longer be evaluated;
- release coverage bookkeeping for disposed runtime nodes while preserving
  snapshot/report history;
- preserve enough lifecycle metadata for devtools to show when a signal existed.

## Tick Semantics

A tick is Veriscope's unit of synchronous UI causality.

Required behavior:

- the first observable mutation in a synchronous turn lazily opens a tick;
- all observable mutations before the active adapter's settle barrier belong to
  that tick;
- nested `batch` or `runInTick` calls remain in the same tick;
- the tick closes at the adapter's settle barrier unless explicitly flushed in
  tests;
- assertions and coverage are evaluated on tick close;
- asynchronous continuations always start a new tick;
- tests can deterministically close pending ticks with a flush API.

This model is intentionally weaker than Comb's delta-cycle scheduler. Veriscope
records and checks host-framework behavior; it does not replace the host
framework's scheduler.

The default settle barrier for framework-agnostic code may be the microtask
boundary. Framework adapters may define stronger barriers. React tests, for
example, should settle through `act()`. React runtime behavior must explicitly
choose how layout effects, passive effects, transitions, Suspense, and deferred
updates are represented instead of assuming they all fit one browser microtask.

Tracked external operations link ticks; they do not merge ticks. A request may
start in tick N, while its response, error, abort, timeout, or stale-result
handler runs in tick M. The operation span records the causal relationship
between N and M.

## External I/O Semantics

External request/response flows are where timeline accuracy matters most and
where inference is least reliable. Veriscope should model them explicitly.

An external operation is a span with:

- a stable operation name;
- a request event;
- zero or more intermediate events;
- a response, error, abort, or timeout event;
- declared input dependencies;
- declared output signals or effects when known.

Request and response events are not forced into one tick. The request event is
recorded in the tick that initiated it. Each response, error, abort, or timeout
continues in a later tick, linked back to the operation span.

The core API should expose explicit operation lifecycle hooks. Names are
illustrative, but the model is required:

- `beginOperation(name, metadata)` records request intent and returns an
  operation ID;
- `resolveOperation(id, value)` records a successful response;
- `rejectOperation(id, error)` records a failed response;
- `abortOperation(id, reason)` records cancellation;
- `timeoutOperation(id)` records timeout;
- `markOperationStale(id, newerId)` records an ignored late response;
- `withOperation(id, fn)` runs response-handling code while linking any emitted
  graph events to that operation.

Operation metadata should include declared input dependencies, declared output
dependencies when known, request keys or sequence numbers when relevant, and the
modeled outcome domain used by exploration.

Veriscope should also support CDC-style async boundary warnings. These are
heuristics, not proofs: if a derived value or effect reads data last written by
an async operation without reading an appropriate guard, request key, or status
signal, Veriscope may warn that the UI is vulnerable to stale, unguarded, or
out-of-order async state.

This gives devtools and assertions two views:

- the **tick view**, which answers "what changed together synchronously?";
- the **operation view**, which answers "which async request caused this later
  UI change?"

Temporal assertions should be able to refer to either view. Examples:

- "submitting starts loading in the same tick";
- "a submit request eventually resolves, errors, aborts, or times out";
- "a successful submit response eventually clears loading";
- "an older response must not overwrite a newer request's result";
- "an aborted request must not update visible success state."

Veriscope should not pretend to verify remote server correctness. It verifies
the UI contract around request initiation, response handling, ordering, aborts,
timeouts, retries, and state updates.

## Assertions

Assertions are executable specifications over graph state and timeline events.

Required assertion kinds:

- `always`: an invariant that must hold whenever assertions are checked;
- `never`: a forbidden condition, represented as its own kind;
- `after`: a temporal property triggered by an edge, event, or operation;
- future operation assertions for request/response spans.

Assertions must carry enough dependency metadata for exploration and debugging.
If dependencies are omitted, Veriscope may still evaluate the assertion, but it
must not claim full exploration coverage for it.

Bare closure assertions are live monitors. Explorable assertions require
declared dependencies for the trigger and the checked property. Veriscope should
not rely on parsing JavaScript function source as a correctness mechanism.

## Exploration And Coverage

The north star is UI development with minimal hand-written interaction tests, so
exploration and coverage are first-class product surfaces.

Exploration should:

- start from assertions and trace backward through dependencies;
- enumerate compact domains for booleans, finite-state values, and annotated
  inputs;
- vary external operation outcomes such as success, error, timeout, abort, slow
  response, and out-of-order response when modeled;
- report what it did and did not cover.

Exploration works from graph topology, declared state domains, declared
operation outcome domains, and assertion metadata. JavaScript closures are opaque
at runtime; expression introspection may be used as a best-effort hint, but not
as a required correctness pillar.

Signal-level exploration is the primary mode. It drives graph roots directly,
settles the adapter, checks assertions, records coverage, and produces violation
traces. Interaction-level exploration is secondary: users may annotate which DOM
interactions drive which graph roots, or tooling may infer that mapping by
observing interactions. Once mapped, interaction driving and signal driving
should produce comparable graph and timeline artifacts.

When exploration finds a violation, the result should include the assertion,
the tick or operation context, relevant signal values, a waveform/timeline trace,
and a minimized reproducing sequence when shrinking is available.

The explorer does not sandbox arbitrary side effects by itself. Tests should use
normal test-environment tools, such as fetch mocks, fake timers, or spy
functions, while Veriscope records the graph and operation behavior exposed by
those mocks.

Coverage should be honest and actionable:

- toggle coverage for boolean-like values;
- finite-state transition coverage for enumerated states;
- cross coverage for explicitly declared combinations;
- operation outcome coverage for tracked external I/O;
- assertion coverage showing which assertions were actually exercised.

Unexplored surfaces should be reported as gaps, not hidden behind optimistic
percentages.

Every coverage percentage needs an explicit denominator. Denominators may come
from declared signal domains, declared transition sets, declared cross products,
declared operation outcome domains, or a clearly labeled observed-only baseline.
Observed-only coverage is useful for debugging, but it must not be presented as
complete state-space coverage.

## Devtools And CLI

Devtools and CLI tools must consume the same graph artifact and timeline schema
as tests. They should not rely on separate, UI-only state.

Required views:

- graph topology and graph diffs;
- tick timeline;
- operation spans for external I/O;
- waveform/value history;
- assertion status and violation context;
- coverage reports and gaps.

The CLI must not claim a snapshot capability until it can produce real snapshots
from the same artifact format that devtools and tests use.

## Package Responsibilities

The extraction plan maps to these Veriscope package responsibilities:

- `@veriscope/graph`: graph data model, node/edge registration, event stream,
  waveform recording, tick manager, operation spans, assertions, graph queries,
  snapshots, and diffs;
- framework adapters such as `@veriscope/react` and `@veriscope/solid`: tracked
  signals, derived values, effects, edge effects, scoping, lifecycle cleanup,
  and adapter settle barriers;
- `@veriscope/coverage`: toggle, finite-state transition, cross, operation
  outcome, and assertion coverage with reporters, thresholds, and merge support;
- `@veriscope/test`: backward-cone exploration, domain generation,
  coverage-steered sampling, adversarial assertion checks, async outcome
  driving, shrinking, and test-framework integration;
- `@veriscope/devtools`: graph, waveform, assertion, operation, and coverage
  views over the shared artifact format;
- `@veriscope/cli`: snapshot capture and graph/timeline diffing over the same
  artifact format;
- mutation tooling: optional feedback on whether assertions catch graph-level or
  behavior-level mutations, built on top of graph, coverage, and test results.

The package list may grow, but these responsibility boundaries should not blur.

## Operational Constraints

The core graph model should be signal-implementation-agnostic so that framework
adapters, vanilla signals, and future standardized signal primitives can share
the same artifact format.

Runtime overhead must be explicit and bounded. Recording should be configurable
with buffer limits, and production builds should be able to remove or disable
Veriscope instrumentation unless an application deliberately opts into runtime
monitoring.

Adapters should stay thin and should not reimplement host framework schedulers.
Their job is to expose tracked primitives, stable identity, lifecycle cleanup,
and a correct settle barrier.

The waveform and graph views are not decorative. They are the first-use proof
that Veriscope is better than logging: a developer should be able to see which
signals changed, which operation caused them, which assertions were pending or
violated, and which coverage gaps remain.

## Non-Goals For V1

V1 should not attempt to provide:

- compiler-emitted static graphs for arbitrary frameworks;
- full JavaScript symbolic execution;
- formal verification of remote services;
- Playwright replacement for layout, accessibility, browser integration, or
  visual behavior;
- automatic tracking of all unannotated Promises, timers, fetches, and external
  side effects;
- Comb scheduler parity.

## Ship Gate

Before treating Veriscope as coherent, the repo should satisfy:

- clean install, build, test, and typecheck from a fresh checkout;
- documented graph artifact schema;
- shared artifact schema consumed by graph, test, coverage, devtools, and CLI;
- core Signal object API with tracked signals, derived values, tracked effects,
  and edge effects;
- lifecycle cleanup with waveform end markers and assertion disposal behavior;
- correct tick batching semantics with tests;
- deterministic test flush API;
- operation span API linking request, response, error, abort, timeout, stale
  response, and response-handling events across ticks;
- stable graph identity for repeated component instances;
- assertion dependency metadata that exploration can trust;
- honest coverage reports with explicit gaps;
- at least one external request/response example covering success, failure,
  abort, timeout, and stale response handling.
