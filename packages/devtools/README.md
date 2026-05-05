# @veriscope/devtools

Standalone web-based debugging UI for inspecting a `@veriscope/graph` `CircuitGraph` at runtime, with circuit, waveform, autotest, and mutation testing panels.

## Installation

```bash
npm install @veriscope/devtools
```

## Quick Example

```ts
import { mountDevtools } from '@veriscope/devtools';
import { runAutotest } from '@veriscope/test';
import type { CircuitGraph, CoverageCollector } from '@veriscope/graph';

const container = document.getElementById('devtools')!;
const graph: CircuitGraph = /* your circuit graph instance */;
const coverage: CoverageCollector = /* optional */;

const handle = mountDevtools(container, graph, {
  coverage,
  autotest: runAutotest,
  initialTab: 'circuit',
  height: '400px',
});

// Later: programmatic control
handle.setTab('autotest');
handle.refresh();
handle.dispose();
```

## API Reference

### `mountDevtools(container, graph, options?)`

Mount the devtools panel into a DOM element.

```ts
function mountDevtools(
  container: HTMLElement,
  graph: CircuitGraph,
  options?: DevtoolsOptions,
): DevtoolsHandle;
```

**Parameters:**

| Parameter   | Type              | Description                                  |
|-------------|-------------------|----------------------------------------------|
| `container` | `HTMLElement`     | The DOM element to mount into                |
| `graph`     | `CircuitGraph`    | The `@veriscope/graph` instance to inspect   |
| `options`   | `DevtoolsOptions` | Optional configuration (see below)           |

**Returns:** `DevtoolsHandle`

---

### `DevtoolsOptions`

```ts
interface DevtoolsOptions {
  coverage?: CoverageCollector;
  autotest?: (graph: CircuitGraph, options?: {
    budget?: number;
    flush?: () => void | Promise<void>;
    name?: string;
    onProgress?: (progress: AutotestProgress) => void | Promise<void>;
  }) => Promise<AutotestResult>;
  explore?: (graph: CircuitGraph, options?: {
    budget?: number;
    flush?: () => void | Promise<void>;
    onProgress?: (progress: AutotestProgress) => void | Promise<void>;
  }) => Promise<ExploreResult>;
  mutate?: (options?: {
    mode?: 'semantic' | 'broad';
    onProgress?: (progress: MutateProgress) => void | Promise<void>;
  }) => Promise<MutateResult>;
  initialTab?: 'circuit' | 'waveform' | 'live-assertions' | 'autotest' | 'mutants';
  height?: string;
}
```

| Property     | Type                                                    | Default      | Description                                                                                      |
|--------------|---------------------------------------------------------|--------------|--------------------------------------------------------------------------------------------------|
| `coverage`   | `CoverageCollector`                                     | `undefined`  | A `CoverageCollector` instance from `@veriscope/graph`; runtime coverage is shown inside Live Assertions. |
| `autotest`   | `runAutotest`-compatible callback                       | `undefined`  | Enables the Autotest tab to drive exploration and report assertions, coverage, and gaps.         |
| `explore`    | `explore`-compatible callback                           | `undefined`  | Fallback exploration runner when no autotest callback is supplied.                               |
| `mutate`     | mutation runner callback                                | `undefined`  | Enables the Mutants tab. Usually wraps `@veriscope/mutate` with an app-specific graph factory.   |
| `initialTab` | `'circuit' \| 'waveform' \| 'live-assertions' \| 'autotest' \| 'mutants'` | `'circuit'` | Which tab is active on mount. Legacy aliases `graph`, `assertions`, and `coverage` are accepted by `mountDevtools`. |
| `height`     | `string`                                                | `'360px'`    | CSS height of the devtools panel.                                                                |

---

### `DevtoolsHandle`

Returned by `mountDevtools`. Provides programmatic control over the panel.

```ts
interface DevtoolsHandle {
  dispose: () => void;
  refresh: () => void;
  setTab: (tab: 'circuit' | 'waveform' | 'live-assertions' | 'autotest' | 'mutants') => void;
}
```

| Method    | Description                                      |
|-----------|--------------------------------------------------|
| `dispose()` | Tear down the UI, remove event listeners, and clean up all panels. |
| `refresh()` | Force-refresh all initialized panels.            |
| `setTab(tab)` | Switch to the specified tab and lazy-initialize its panel if needed. |

---

### `TabId`

Re-exported type representing valid tab identifiers.

```ts
type TabId = 'circuit' | 'waveform' | 'live-assertions' | 'autotest' | 'mutants';
```

---

### `createTabLayout(container)`

Creates the tab bar chrome (title bar, tab buttons, content panel slots). Used internally by `mountDevtools`.

```ts
function createTabLayout(container: HTMLElement): TabLayout;
```

**Returns:** `TabLayout`

```ts
interface TabLayout {
  container: HTMLElement;
  tabBar: HTMLElement;
  contentPanels: Map<TabId, HTMLElement>;
  activeTab: TabId;
  setActive: (tab: TabId) => void;
  onTabChange: (cb: (tab: TabId) => void) => void;
  dispose: () => void;
}
```

| Property / Method | Description |
|---|---|
| `container` | The root element passed in. |
| `tabBar` | The `<div>` containing tab buttons. |
| `contentPanels` | Map from `TabId` to the content `<div>` for each tab. |
| `activeTab` | The currently active tab id. |
| `setActive(tab)` | Switch to the given tab (updates button styles and panel visibility). |
| `onTabChange(cb)` | Register a callback invoked whenever the active tab changes. |
| `dispose()` | Clears `container.innerHTML`. |

---

### `createWaveformPanel(container, graph)`

Canvas-based waveform viewer with hierarchy browser, dual markers, search, and keyboard shortcuts.

```ts
function createWaveformPanel(
  container: HTMLElement,
  graph: CircuitGraph,
): { dispose: () => void; refresh: () => void };
```

**Features:**

- Automatically calls `graph.startRecording()` to ensure event data is captured.
- Persists view state (zoom range, marker positions, hidden signals) to `localStorage` under keys prefixed `veriscope-waveform-`.
- Hierarchy browser on the left groups signals by dotted-name prefix and supports collapsing groups, toggling signal visibility, and switching render mode (analog/digital).
- Dual marker system: click in the chart area to place marker A; shift-click for marker B. Hold Alt/Meta to snap to the nearest signal edge. Displays delta-t between markers.
- Cross-signal search with a query language supporting comparisons (`signal > 5`, `signal == true`), edge detection (`signal rises`, `signal falls`), boolean combinators (`A rises AND B == false`), and proximity queries (`A rises WITHIN 10 OF B falls`). Navigate matches with arrow buttons or Enter/Shift+Enter.
- Renders boolean signals as filled regions, numeric signals as analog lines or digital step waveforms, and assertion nodes as colored overlay bars (green/red/yellow for passed/failed/armed).
- Export JSON button downloads all waveform data as a timestamped JSON file.
- Zoom controls: Fit, Zoom +, Zoom -, and mouse wheel with Ctrl/Meta held zooms around the cursor.
- Keyboard shortcuts (active when mouse is over the panel): `+`/`=` zoom in, `-` zoom out, Left/Right arrow pan, Home fit-to-data, Escape clear markers.

---

### `createVisualizerPanel(container, graph)`

Canvas-based dependency graph visualizer using topological layering.

```ts
function createVisualizerPanel(
  container: HTMLElement,
  graph: CircuitGraph,
): { dispose: () => void; refresh: () => void };
```

**Features:**

- Reads nodes and edges from the `CircuitGraph` and lays them out in topological layers (left-to-right). Nodes with no incoming edges appear in layer 0.
- Nodes are color-coded by type: signal (`#6ee7f9`), derived (`#a78bfa`), effect (`#72f1b8`), assertion (`#ff5d8f`).
- Edges are drawn as bezier curves with arrowheads.
- Hover tooltip shows node name, type, current value (if available via `node.getValue()`), and dependency count.
- Subscribes to graph events and redraws as nodes, edges, signal values, derived values, effects, and assertion states change.

---

### Live Assertions Panel

Runtime assertion monitor that subscribes to graph events and tracks pass/fail/armed status from the actual running graph.

**Features:**

- Subscribes to the graph's event stream (`graph.subscribe`) and listens for `assertion-armed`, `assertion-passed`, and `assertion-failed` events.
- Displays a summary bar showing counts of passed, failed, armed, and unchecked assertions.
- Each assertion row shows: status indicator (colored dot), assertion name, kind badge, and cumulative pass/fail counts.
- Runtime `CoverageCollector` summaries are shown in this panel when provided.

### Autotest Panel

Generated-case autotest monitor. "Run Autotest" drives `runAutotest()` when provided, shows live progress from `onProgress`, then reports generated scenarios, assertion results, reachable coverage, runtime counters, and explicit gaps. Live assertion pass/fail counts from the running app are intentionally not mixed into this tab.

---

### Mutants Panel

Mutation testing surface for generated graph mutations. Pass a callback backed by `@veriscope/mutate` to enable the button; the panel supports Semantic Score and Broad Sweep modes, shows live progress from `onProgress`, and reports total, killed, survived, invalid, equivalent, skipped, autotest runs, and score after the runner completes.

---

### `WaveformSignal`

Describes a signal displayed in the waveform panel.

```ts
interface WaveformSignal {
  id: string;
  displayName: string;
  group: string;
  type: 'boolean' | 'numeric' | 'enum' | 'assertion' | 'coverage';
  visible: boolean;
  color: string;
  renderMode: 'analog' | 'digital';
}
```

| Field | Description |
|---|---|
| `id` | Graph node id. |
| `displayName` | Last segment of the dotted node name. |
| `group` | Hierarchy group derived from the name prefix (e.g., `"player1"` from `"player1.score"`). Defaults to `"signals"`. |
| `type` | Inferred from the node's value type and graph node type. |
| `visible` | Whether the signal is shown in the waveform view. |
| `color` | Display color (assigned round-robin from a built-in palette). |
| `renderMode` | `'digital'` for step waveforms, `'analog'` for interpolated lines. Boolean signals default to `'digital'`. |

---

### `TabDefinition`

Describes a tab in the layout.

```ts
interface TabDefinition {
  id: TabId;
  label: string;
}
```

## Tabs

### Waveform

Time-series waveform viewer. Shows all `signal` and `derived` nodes from the `CircuitGraph` as waveform traces on a shared timeline. Assertion nodes appear as colored overlay bars. Supports panning, zooming, dual markers with delta-t display, a hierarchy browser sidebar for signal management, and a cross-signal search bar.

### Circuit

Dependency graph visualizer. Displays all graph nodes as color-coded boxes arranged in topological layers with bezier-curve edges showing data flow. Hover any node to see its current value and dependency count. Redraws live from graph events.

### Live Assertions

Runtime assertion monitor. Lists every assertion node from the graph with pass/fail/armed counts from actual graph events and shows runtime coverage counters when a collector is supplied.

### Autotest

Generated-case autotest monitor. Runs exploration/autotest when supplied, shows progress, and reports generated cases, assertion outcomes, coverage, and gaps.

### Mutants

Mutation testing monitor. Runs an app-provided mutation callback and reports killed and surviving generated mutations.
