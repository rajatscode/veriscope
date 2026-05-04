// @veriscope/devtools — Standalone web-based debugging UI
// Provides waveform viewing, graph visualization, assertion monitoring, and coverage display
// Bridge is imported for side effects only: import '@veriscope/devtools/bridge'

import type { CircuitGraph, CoverageCollector } from '@veriscope/graph';
import { createTabLayout } from './layout.js';
import { createWaveformPanel } from './waveform.js';
import { createVisualizerPanel } from './visualizer.js';
import { createAssertionsPanel } from './assertions.js';
import { createCoveragePanel } from './coverage.js';

export type { TabId } from './layout.js';

export interface DevtoolsOptions {
  /** CoverageCollector instance (optional — coverage tab will show empty state without it) */
  coverage?: CoverageCollector;
  /** Initial active tab */
  initialTab?: 'waveform' | 'graph' | 'assertions' | 'coverage';
  /** Height of the devtools panel (default: '360px') */
  height?: string;
}

export interface DevtoolsHandle {
  /** Tear down the devtools UI and clean up listeners */
  dispose: () => void;
  /** Force refresh all panels */
  refresh: () => void;
  /** Switch to a specific tab */
  setTab: (tab: 'waveform' | 'graph' | 'assertions' | 'coverage') => void;
}

/**
 * Mount the Veriscope devtools panel into a container element.
 *
 * @param container - The HTML element to mount into
 * @param graph - The CircuitGraph instance to inspect
 * @param options - Optional configuration
 * @returns A handle with dispose(), refresh(), and setTab() methods
 */
export function mountDevtools(
  container: HTMLElement,
  graph: CircuitGraph,
  options?: DevtoolsOptions,
): DevtoolsHandle {
  const height = options?.height ?? '360px';
  container.style.height = height;

  const layout = createTabLayout(container);
  const disposers: Array<() => void> = [];

  // Waveform panel
  const waveformContainer = layout.contentPanels.get('waveform')!;
  const waveform = createWaveformPanel(waveformContainer, graph);
  disposers.push(waveform.dispose);

  // Graph visualizer panel
  const graphContainer = layout.contentPanels.get('graph')!;
  let visualizer: ReturnType<typeof createVisualizerPanel> | null = null;

  // Assertions panel
  const assertionsContainer = layout.contentPanels.get('assertions')!;
  let assertions: ReturnType<typeof createAssertionsPanel> | null = null;

  // Coverage panel
  const coverageContainer = layout.contentPanels.get('coverage')!;
  let coveragePanel: ReturnType<typeof createCoveragePanel> | null = null;

  // Lazy-init panels on tab switch (avoid unnecessary work for hidden tabs)
  function ensurePanel(tab: string) {
    if (tab === 'graph' && !visualizer) {
      visualizer = createVisualizerPanel(graphContainer, graph);
      disposers.push(visualizer.dispose);
    }
    if (tab === 'assertions' && !assertions) {
      assertions = createAssertionsPanel(assertionsContainer, graph);
      disposers.push(assertions.dispose);
    }
    if (tab === 'coverage' && !coveragePanel) {
      if (options?.coverage) {
        coveragePanel = createCoveragePanel(coverageContainer, options.coverage);
        disposers.push(coveragePanel.dispose);
      } else {
        // Show a message that no coverage collector was provided
        coverageContainer.style.cssText = 'height:100%; display:flex; align-items:center; justify-content:center; color:#666; font-size:0.8rem; font-family:"SF Mono",monospace;';
        coverageContainer.textContent = 'No CoverageCollector provided. Pass { coverage } option to mountDevtools().';
      }
    }
  }

  layout.onTabChange((tab) => {
    ensurePanel(tab);
    // Refresh the newly active panel
    if (tab === 'waveform') waveform.refresh();
    if (tab === 'graph') visualizer?.refresh();
    if (tab === 'assertions') assertions?.refresh();
    if (tab === 'coverage') coveragePanel?.refresh();
  });

  // Initialize with the requested tab
  const initialTab = options?.initialTab ?? 'waveform';
  layout.setActive(initialTab);
  ensurePanel(initialTab);

  return {
    dispose() {
      for (const d of disposers) d();
      layout.dispose();
    },
    refresh() {
      waveform.refresh();
      visualizer?.refresh();
      assertions?.refresh();
      coveragePanel?.refresh();
    },
    setTab(tab) {
      layout.setActive(tab);
      ensurePanel(tab);
    },
  };
}
