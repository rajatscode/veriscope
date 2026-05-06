// @veriscope/devtools — Standalone web-based debugging UI
// Provides circuit, waveform, autotest, and mutation testing panels
// Bridge is imported for side effects only: import '@veriscope/devtools/bridge'

import { coverage as globalCoverage, type CircuitGraph, type CoverageCollector, type GraphSnapshot } from '@veriscope/graph';
import { createTabLayout } from './layout.js';
import { createWaveformPanel } from './waveform.js';
import { createVisualizerPanel } from './visualizer.js';
import { createAssertionsPanel } from './assertions.js';
import { createLiveAssertionsPanel } from './liveAssertions.js';
import { createMutantsPanel } from './mutants.js';

export { createWaveformPanel } from './waveform.js';
export { createVisualizerPanel } from './visualizer.js';
export { createAssertionsPanel } from './assertions.js';
export { createLiveAssertionsPanel } from './liveAssertions.js';
export { createMutantsPanel } from './mutants.js';
export { createTabLayout } from './layout.js';
export type { TabLayout, TabDefinition, TabId } from './layout.js';

export interface ExploreResult {
  violations: Array<{ assertionName: string; tick: number; signalValues: Record<string, any>; sequence: Array<{ signal: string; value: any }> }>;
  scenarios: Array<{
    id: string;
    kind: 'enumerated' | 'current-state' | 'sequence' | 'operation-outcome' | 'coverage-directed' | 'coverage-completion' | 'adversarial';
    tick: number;
    steps: Array<{ signal: string; value: any }>;
    assertions: string[];
    violations: string[];
    observations?: Array<{
      type:
        | 'signal-change'
        | 'derived-recompute'
        | 'assertion-armed'
        | 'assertion-passed'
        | 'assertion-failed'
        | 'operation-begin'
        | 'operation-resolve'
        | 'operation-reject'
        | 'operation-abort'
        | 'operation-timeout'
        | 'operation-stale';
      node: string;
      oldValue?: any;
      newValue?: any;
      operationId?: string;
      operationName?: string;
      status?: string;
    }>;
  }>;
  coverage: {
    toggle: { covered: number; total: number; percentage: number };
    transitions: { covered: number; total: number; percentage: number };
    cross: { covered: number; total: number; percentage: number };
    operations: { covered: number; total: number; percentage: number };
    overall: { covered: number; total: number; percentage: number };
    gaps: Array<{ kind: string; id: string; missing: string[] }>;
  };
  steps: number;
  plan?: {
    deterministic: boolean;
    seed?: string | number;
    budget: number;
    exhausted: boolean;
    stoppedByBudget: boolean;
    generatedCases: number;
    hiddenDuplicateCases: number;
    generatedReachableCoverage: { covered: number; total: number; percentage: number };
    phaseCounts: Record<string, number>;
  };
  snapshot?: GraphSnapshot;
}

export interface AutotestProgress {
  phase: ExploreResult['scenarios'][number]['kind'] | 'setup' | 'complete';
  steps: number;
  budget: number;
  generatedCases: number;
  hiddenDuplicateCases: number;
  stoppedByBudget: boolean;
}

export interface AutotestResult extends ExploreResult {
  status: 'passed' | 'failed';
  assertions: Array<{
    id: string;
    name: string;
    kind: string;
    status: 'passed' | 'failed';
    partialCoverage: boolean;
    confidence: 'verified' | 'partial' | 'unverifiable';
    reason?: string;
    exercised?: boolean;
    scenarioCount?: number;
    passScenarioCount?: number;
    failScenarioCount?: number;
  }>;
  confidence: {
    verified: number;
    partial: number;
    unverifiable: number;
  };
}

export interface MutateResult {
  total: number;
  killed: number;
  killedMutations: Array<{ mutation: string; description: string; scenarioId?: string; assertionName?: string }>;
  survived: Array<{ mutation: string; description: string }>;
  invalid?: Array<{ mutation: string; description: string; error: string }>;
  equivalent?: Array<{ mutation: string; description: string; reason: string }>;
  unobserved?: Array<{ mutation: string; description: string; reason: string }>;
  score: number;
  budgetPerMutation?: number;
  autotestRuns?: number;
  autotestSteps?: number;
  /** Optional seed for randomized or fuzzing-backed mutation runners. */
  seed?: string | number;
  generatedMutants?: number;
  skipped?: Array<{ mutation: string; description: string; reason: string }>;
}

export interface MutateProgress {
  total: number;
  completed: number;
  generatedMutants: number;
  skipped: number;
  unobserved: number;
  currentMutation?: string;
  killed: number;
  survived: number;
  invalid: number;
  equivalent: number;
  budgetPerMutation: number;
  autotestRuns: number;
  autotestSteps: number;
  seed?: string | number;
}

export interface DevtoolsOptions {
  /** CoverageCollector instance. Runtime coverage is shown inside the Live Assertions tab. */
  coverage?: CoverageCollector;
  /** runAutotest() from @veriscope/test. Enables the Autotest tab. */
  autotest?: (graph: CircuitGraph, options?: { budget?: number; flush?: () => void | Promise<void>; name?: string; onProgress?: (progress: AutotestProgress) => void | Promise<void> }) => Promise<AutotestResult>;
  /** explore() function from @veriscope/test (optional fallback when no autotest runner is provided) */
  explore?: (graph: CircuitGraph, options?: { budget?: number; flush?: () => void | Promise<void>; onProgress?: (progress: AutotestProgress) => void | Promise<void> }) => Promise<ExploreResult>;
  /** Mutation runner callback, normally backed by @veriscope/mutate. Enables the Mutants tab. */
  mutate?: (options?: { mode?: 'semantic' | 'broad'; onProgress?: (progress: MutateProgress) => void | Promise<void> }) => Promise<MutateResult>;
  /** Initial active tab */
  initialTab?: 'circuit' | 'waveform' | 'live-assertions' | 'autotest' | 'mutants' | 'graph' | 'assertions' | 'coverage';
  /** Height of the devtools panel (default: '360px') */
  height?: string;
}

export interface DevtoolsHandle {
  /** Tear down the devtools UI and clean up listeners */
  dispose: () => void;
  /** Force refresh all panels */
  refresh: () => void;
  /** Switch to a specific tab */
  setTab: (tab: 'circuit' | 'waveform' | 'live-assertions' | 'autotest' | 'mutants') => void;
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
  let activeTab = normalizeTab(options?.initialTab ?? 'circuit');

  // Circuit panel
  const circuitContainer = layout.contentPanels.get('circuit')!;
  let visualizer: ReturnType<typeof createVisualizerPanel> | null = null;

  // Waveform panel
  const waveformContainer = layout.contentPanels.get('waveform')!;
  const waveform = createWaveformPanel(waveformContainer, graph);
  disposers.push(waveform.dispose);

  // Live assertions panel
  const liveAssertionsContainer = layout.contentPanels.get('live-assertions')!;
  let liveAssertions: ReturnType<typeof createLiveAssertionsPanel> | null = null;

  // Autotest panel
  const autotestContainer = layout.contentPanels.get('autotest')!;
  let autotest: ReturnType<typeof createAssertionsPanel> | null = null;

  // Mutants panel
  const mutantsContainer = layout.contentPanels.get('mutants')!;
  let mutants: ReturnType<typeof createMutantsPanel> | null = null;

  let disposed = false;

  // Lazy-init panels on tab switch (avoid unnecessary work for hidden tabs)
  function ensurePanel(tab: string) {
    if (tab === 'circuit' && !visualizer) {
      visualizer = createVisualizerPanel(circuitContainer, graph, {
        isActive: () => activeTab === 'circuit',
      });
      disposers.push(visualizer.dispose);
    }
    if (tab === 'autotest' && !autotest) {
      if (options?.autotest || options?.explore) {
        autotest = createAssertionsPanel(autotestContainer, graph, {
          autotest: options.autotest,
          explore: options.explore,
        });
      } else {
        autotest = createAssertionsPanel(autotestContainer, graph, {});
        tryDiscoverAutotest().then(discovered => {
          if (discovered && !disposed) {
            autotest?.dispose();
            autotest = createAssertionsPanel(autotestContainer, graph, discovered);
            if (activeTab === 'autotest') autotest.refresh();
          }
        });
      }
      disposers.push(() => autotest?.dispose());
    }
    if (tab === 'live-assertions' && !liveAssertions) {
      liveAssertions = createLiveAssertionsPanel(liveAssertionsContainer, graph, {
        coverage: options?.coverage ?? globalCoverage,
      });
      disposers.push(liveAssertions.dispose);
    }
    if (tab === 'mutants' && !mutants) {
      if (options?.mutate) {
        mutants = createMutantsPanel(mutantsContainer, { mutate: options.mutate });
      } else {
        mutants = createMutantsPanel(mutantsContainer, {});
        mutantsContainer.insertAdjacentHTML('beforeend',
          '<p style="color:#888;font-size:13px;padding:8px 12px;margin:0">' +
          'Mutation testing requires a graph factory function. ' +
          'Pass a <code>mutate</code> callback to <code>mountDevtools()</code> — see docs.</p>');
      }
      disposers.push(() => mutants?.dispose());
    }
  }

  layout.onTabChange((tab) => {
    activeTab = tab;
    ensurePanel(tab);
    // Refresh the newly active panel
    if (tab === 'circuit') visualizer?.refresh();
    if (tab === 'waveform') waveform.refresh();
    if (tab === 'live-assertions') liveAssertions?.refresh();
    if (tab === 'autotest') autotest?.refresh();
    if (tab === 'mutants') mutants?.refresh();
  });

  // Initialize with the requested tab
  layout.setActive(activeTab);
  ensurePanel(activeTab);

  return {
    dispose() {
      disposed = true;
      for (const d of disposers) d();
      layout.dispose();
    },
    refresh() {
      if (activeTab === 'circuit') visualizer?.refresh();
      if (activeTab === 'waveform') waveform.refresh();
      if (activeTab === 'live-assertions') liveAssertions?.refresh();
      if (activeTab === 'autotest') autotest?.refresh();
      if (activeTab === 'mutants') mutants?.refresh();
    },
    setTab(tab) {
      layout.setActive(tab);
      ensurePanel(tab);
    },
  };
}

function normalizeTab(tab: NonNullable<DevtoolsOptions['initialTab']>): 'circuit' | 'waveform' | 'live-assertions' | 'autotest' | 'mutants' {
  if (tab === 'graph') return 'circuit';
  if (tab === 'assertions') return 'live-assertions';
  if (tab === 'coverage') return 'autotest';
  return tab;
}

async function tryDiscoverAutotest(): Promise<{ autotest?: DevtoolsOptions['autotest']; explore?: DevtoolsOptions['explore'] } | null> {
  try {
    const testModule: Record<string, any> = await import('@veriscope/test');
    if (typeof testModule.runAutotest === 'function') {
      return {
        autotest: async (g, opts) => {
          g.enterSandbox();
          try {
            return await testModule.runAutotest(g, opts);
          } finally {
            g.exitSandbox();
          }
        },
      };
    }
    if (typeof testModule.explore === 'function') {
      return {
        explore: async (g, opts) => {
          g.enterSandbox();
          try {
            return await testModule.explore(g, opts);
          } finally {
            g.exitSandbox();
          }
        },
      };
    }
  } catch {
    // @veriscope/test not installed
  }
  return null;
}
