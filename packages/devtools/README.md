# @veriscope/devtools

Standalone web-based debugging UI for inspecting a `@veriscope/graph` `CircuitGraph` at runtime, with waveform viewing, graph visualization, assertion monitoring, and coverage display.

## Installation

```bash
npm install @veriscope/devtools
```

## Quick Example

```ts
import { mountDevtools } from '@veriscope/devtools';
import type { CircuitGraph, CoverageCollector } from '@veriscope/graph';

const container = document.getElementById('devtools')!;
const graph: CircuitGraph = /* your circuit graph instance */;
const coverage: CoverageCollector = /* optional */;

const handle = mountDevtools(container, graph, {
  coverage,
  initialTab: 'waveform',
  height: '400px',
});

// Later: programmatic control
handle.setTab('assertions');
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
  initialTab?: 'waveform' | 'graph' | 'assertions' | 'coverage';
  height?: string;
}
```

| Property     | Type                                                    | Default      | Description                                                                                      |
|--------------|---------------------------------------------------------|--------------|--------------------------------------------------------------------------------------------------|
| `coverage`   | `CoverageCollector`                                     | `undefined`  | A `CoverageCollector` instance from `@veriscope/graph`. Without it the Coverage tab shows an empty state message. |
| `initialTab` | `'waveform' \| 'graph' \| 'assertions' \| 'coverage'`  | `'waveform'` | Which tab is active on mount.                                                                    |
| `height`     | `string`                                                | `'360px'`    | CSS height of the devtools panel.                                                                |

---

### `DevtoolsHandle`

Returned by `mountDevtools`. Provides programmatic control over the panel.

```ts
interface DevtoolsHandle {
  dispose: () => void;
  refresh: () => void;
  setTab: (tab: 'waveform' | 'graph' | 'assertions' | 'coverage') => void;
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
type TabId = 'waveform' | 'graph' | 'assertions' | 'coverage';
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

---

### `createAssertionsPanel(container, graph)`

Live assertion monitor that subscribes to graph events and tracks pass/fail/armed status.

```ts
function createAssertionsPanel(
  container: HTMLElement,
  graph: CircuitGraph,
): { dispose: () => void; refresh: () => void };
```

**Features:**

- Subscribes to the graph's event stream (`graph.subscribe`) and listens for `assertion-armed`, `assertion-passed`, and `assertion-failed` events.
- Displays a summary bar showing counts of passed, failed, armed, and unchecked assertions.
- Each assertion row shows: status indicator (colored dot), assertion name, kind badge, and cumulative pass/fail counts.
- "Check All" button triggers `graph.checkAssertions()` and re-renders.

---

### `createCoveragePanel(container, collector)`

Coverage display showing toggle coverage, FSM transition matrices, and cross coverage grids.

```ts
function createCoveragePanel(
  container: HTMLElement,
  collector: CoverageCollector,
): { dispose: () => void; refresh: () => void };
```

**Features:**

- Summary bar shows overall coverage percentage with a color-coded progress bar (green >= 80%, yellow >= 50%, red < 50%).
- **Toggle coverage:** Grid showing which boolean signals have been observed as `true` and `false`.
- **Transition coverage:** Per-FSM matrix showing observed state transitions with hit counts. States are listed on both axes (from/to).
- **Cross coverage:** Per-group grid of observed value combinations across multiple signals, displayed as small colored cells (green = hit, dark = not hit). Supports up to 64 combinations per group. Hover for bin key and count.
- Enable/Disable button to toggle coverage collection at runtime via `collector.enable()` / `collector.disable()`.

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

### Graph

Dependency graph visualizer. Displays all graph nodes as color-coded boxes arranged in topological layers with bezier-curve edges showing data flow. Hover any node to see its current value and dependency count.

### Assertions

Live assertion status monitor. Lists every assertion node from the graph with its current state (unknown, armed, passed, or failed) and cumulative pass/fail counts. Subscribes to graph events for real-time updates. Includes a "Check All" button to manually trigger assertion evaluation.

### Coverage

Coverage collection dashboard. Requires a `CoverageCollector` passed via options. Shows overall coverage percentage, a toggle coverage matrix (true/false observation per signal), FSM transition coverage matrices with hit counts, and cross coverage grids showing which value combinations have been observed.
