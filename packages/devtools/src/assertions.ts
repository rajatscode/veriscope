// assertions.ts — Autotest panel: generated scenarios, assertion outcomes, and coverage from explicit runs

import type { CircuitGraph } from '@veriscope/graph';
import type { AutotestProgress, AutotestResult, ExploreResult } from './index.js';

interface AssertionsPanelOptions {
  autotest?: (graph: CircuitGraph, options?: { budget?: number; flush?: () => void | Promise<void>; name?: string; onProgress?: (progress: AutotestProgress) => void | Promise<void> }) => Promise<AutotestResult>;
  explore?: (graph: CircuitGraph, options?: { budget?: number; flush?: () => void | Promise<void>; onProgress?: (progress: AutotestProgress) => void | Promise<void> }) => Promise<ExploreResult>;
}

interface AutotestRunStatus {
  number: number;
  status: 'running' | 'completed' | 'failed';
  mode: 'autotest' | 'explore';
  startedAt: Date;
  startedAtMs: number;
  finishedAt?: Date;
  durationMs?: number;
  phase?: AutotestProgress['phase'];
  steps?: number;
  budget?: number;
  generatedCases?: number;
  hiddenDuplicateCases?: number;
  stoppedByBudget?: boolean;
}

function isAutotestResult(result: AutotestResult | ExploreResult): result is AutotestResult {
  return Array.isArray((result as Partial<AutotestResult>).assertions);
}

function formatScenarioValue(value: unknown): string {
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') return '{...}';
  return String(value);
}

function formatObservationValue(value: unknown): string {
  return formatScenarioValue(value);
}

function formatClock(value: Date): string {
  return value.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(ms: number | undefined): string {
  if (!Number.isFinite(ms)) return 'n/a';
  if ((ms ?? 0) < 1000) return `${Math.max(0, Math.round(ms ?? 0))}ms`;
  return `${((ms ?? 0) / 1000).toFixed(2)}s`;
}

function waitForPaint(): Promise<void> {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

function renderScenarioItem(scenario: ExploreResult['scenarios'][number]): HTMLElement {
  const item = document.createElement('div');
  item.style.cssText = 'padding:5px 6px; margin-top:4px; background:rgba(255,255,255,0.025); border:1px solid #21262d; border-radius:3px; font-size:0.68rem;';

  const failedAssertions = scenario.violations.filter((name, index, names) => names.indexOf(name) === index);
  const header = document.createElement('div');
  header.style.cssText = 'display:flex; justify-content:space-between; gap:8px; color:#8b949e;';
  const left = document.createElement('span');
  left.textContent = `${scenario.id} · ${scenario.kind}`;
  const right = document.createElement('span');
  right.style.cssText = failedAssertions.length > 0 ? 'color:#ff5d8f; text-align:right;' : 'color:#72f1b8;';
  right.textContent = failedAssertions.length > 0
    ? `failed: ${failedAssertions.join(', ')}`
    : 'passed';
  header.appendChild(left);
  header.appendChild(right);
  item.appendChild(header);

  const stepsLine = document.createElement('div');
  stepsLine.style.cssText = 'color:#c9d1d9; margin-top:3px; overflow-wrap:anywhere;';
  stepsLine.textContent = scenario.steps.length > 0
    ? scenario.steps.map(step => `${step.signal}=${formatScenarioValue(step.value)}`).join(', ')
    : '(current state)';
  item.appendChild(stepsLine);

  if (scenario.assertions.length > 0) {
    const assertionLine = document.createElement('div');
    assertionLine.style.cssText = 'color:#666; margin-top:2px; overflow-wrap:anywhere;';
    assertionLine.textContent = `checks ${scenario.assertions.join(', ')}`;
    item.appendChild(assertionLine);
  }

  if (failedAssertions.length > 0) {
    const failedLine = document.createElement('div');
    failedLine.style.cssText = 'color:#ff5d8f; margin-top:2px; overflow-wrap:anywhere;';
    failedLine.textContent = `failed assertions: ${failedAssertions.join(', ')}`;
    item.appendChild(failedLine);
  }

  const propagations = scenario.observations?.filter(obs => obs.type === 'derived-recompute') ?? [];
  if (propagations.length > 0) {
    const propagationLine = document.createElement('div');
    propagationLine.style.cssText = 'color:#a78bfa; margin-top:2px; overflow-wrap:anywhere;';
    propagationLine.textContent = `propagated: ${propagations.slice(0, 4).map(obs =>
      `${obs.node} ${formatObservationValue(obs.oldValue)} -> ${formatObservationValue(obs.newValue)}`,
    ).join(', ')}${propagations.length > 4 ? ` +${propagations.length - 4} more` : ''}`;
    item.appendChild(propagationLine);
  }

  const assertionObservations = scenario.observations?.filter(obs =>
    obs.type === 'assertion-armed' || obs.type === 'assertion-passed' || obs.type === 'assertion-failed',
  ) ?? [];
  const temporalEvents = [
    ...assertionObservations.filter(obs => obs.type === 'assertion-armed' || obs.type === 'assertion-failed'),
    ...assertionObservations.filter(obs => obs.type === 'assertion-passed'),
  ];
  if (temporalEvents.length > 0) {
    const temporalLine = document.createElement('div');
    temporalLine.style.cssText = 'color:#f8d66d; margin-top:2px; overflow-wrap:anywhere;';
    temporalLine.textContent = `assertion events: ${temporalEvents.slice(0, 5).map(obs =>
      `${obs.type.replace('assertion-', '')}:${obs.node}`,
    ).join(', ')}${temporalEvents.length > 5 ? ` +${temporalEvents.length - 5} more` : ''}`;
    item.appendChild(temporalLine);
  }

  const operationEvents = scenario.observations?.filter(obs => obs.type.startsWith('operation-')) ?? [];
  if (operationEvents.length > 0) {
    const operationLine = document.createElement('div');
    operationLine.style.cssText = 'color:#58a6ff; margin-top:2px; overflow-wrap:anywhere;';
    operationLine.textContent = `operation events: ${operationEvents.slice(0, 5).map(obs =>
      `${obs.operationName ?? obs.node}:${obs.status ?? obs.type.replace('operation-', '')}`,
    ).join(', ')}${operationEvents.length > 5 ? ` +${operationEvents.length - 5} more` : ''}`;
    item.appendChild(operationLine);
  }

  return item;
}

export function createAssertionsPanel(
  container: HTMLElement,
  graph: CircuitGraph,
  options?: AssertionsPanelOptions,
): { dispose: () => void; refresh: () => void } {
  container.style.cssText = 'height:100%; overflow-y:auto; padding:12px; font-family:"SF Mono","Fira Code",monospace; font-size:0.8rem;';

  let disposed = false;
  let lastRunResult: AutotestResult | ExploreResult | null = null;
  let running = false;
  let error: string | null = null;
  let runNumber = 0;
  let activeRun: AutotestRunStatus | null = null;
  let lastRun: AutotestRunStatus | null = null;
  let liveTimer: ReturnType<typeof setInterval> | null = null;

  function stopLiveTimer() {
    if (liveTimer) {
      clearInterval(liveTimer);
      liveTimer = null;
    }
  }

  function startLiveTimer() {
    stopLiveTimer();
    liveTimer = setInterval(() => {
      if (!disposed && activeRun) render();
    }, 250);
  }

  async function runAutotestFromPanel() {
    if (running || (!options?.autotest && !options?.explore)) return;

    const mode = options.autotest ? 'autotest' : 'explore';
    const budget = 1000;
    const startedAt = new Date();
    const startedAtMs = performance.now();
    runNumber++;
    activeRun = {
      number: runNumber,
      status: 'running',
      mode,
      startedAt,
      startedAtMs,
      phase: 'setup',
      steps: 0,
      budget,
      generatedCases: 0,
      hiddenDuplicateCases: 0,
      stoppedByBudget: false,
    };
    running = true;
    error = null;
    render();
    startLiveTimer();

    const onProgress = async (progress: AutotestProgress) => {
      if (disposed || !activeRun) return;
      activeRun = {
        ...activeRun,
        phase: progress.phase,
        steps: progress.steps,
        budget: progress.budget,
        generatedCases: progress.generatedCases,
        hiddenDuplicateCases: progress.hiddenDuplicateCases,
        stoppedByBudget: progress.stoppedByBudget,
      };
      render();
      await waitForPaint();
    };

    try {
      await waitForPaint();
      if (disposed) return;
      const result = options.autotest
        ? await options.autotest(graph, {
          budget,
          name: 'devtools-autotest',
          onProgress,
          flush: async () => { await new Promise(r => setTimeout(r, 0)); },
        })
        : await options.explore!(graph, {
          budget,
          onProgress,
          flush: async () => { await new Promise(r => setTimeout(r, 0)); },
        });
      lastRunResult = result;
      lastRun = {
        number: runNumber,
        status: 'completed',
        mode,
        startedAt,
        startedAtMs,
        finishedAt: new Date(),
        durationMs: performance.now() - startedAtMs,
        generatedCases: result.scenarios.length,
        steps: result.steps,
        budget: result.plan?.budget ?? budget,
        phase: 'complete',
        hiddenDuplicateCases: result.plan?.hiddenDuplicateCases,
        stoppedByBudget: result.plan?.stoppedByBudget,
      };
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      lastRun = {
        number: runNumber,
        status: 'failed',
        mode,
        startedAt,
        startedAtMs,
        finishedAt: new Date(),
        durationMs: performance.now() - startedAtMs,
      };
    } finally {
      stopLiveTimer();
      activeRun = null;
      running = false;
      render();
    }
  }

  function renderRunStatus(status: AutotestRunStatus, hasPreviousResult: boolean): HTMLElement {
    const box = document.createElement('div');
    const isRunning = status.status === 'running';
    const isFailed = status.status === 'failed';
    const label = status.mode === 'autotest' ? 'Autotest' : 'Explore';
    box.style.cssText = `
      color:${isFailed ? '#ff5d8f' : isRunning ? '#f8d66d' : '#8b949e'};
      padding:8px;
      background:${isFailed ? 'rgba(255,93,143,0.08)' : isRunning ? 'rgba(248,214,109,0.08)' : 'rgba(255,255,255,0.03)'};
      border:1px solid ${isFailed ? 'rgba(255,93,143,0.2)' : isRunning ? 'rgba(248,214,109,0.2)' : '#21262d'};
      border-radius:4px;
      margin-bottom:10px;
      font-size:0.72rem;
      line-height:1.45;
    `;

    if (isRunning) {
      const total = status.budget ?? 0;
      const completed = status.steps ?? 0;
      const pct = total > 0 ? Math.min(100, (completed / total) * 100) : 0;
      const generated = status.generatedCases ?? 0;
      const hidden = status.hiddenDuplicateCases ?? 0;
      box.innerHTML = `
        <div style="color:#f8d66d; font-weight:600;">${label} run #${status.number} running</div>
        <div>Started: ${formatClock(status.startedAt)}</div>
        <div>Elapsed: ${formatDuration(performance.now() - status.startedAtMs)}</div>
        <div style="margin:6px 0 4px; height:6px; background:#21262d; border-radius:999px; overflow:hidden;">
          <div style="height:100%; width:${pct.toFixed(1)}%; background:#f8d66d;"></div>
        </div>
        <div>Progress: ${completed}/${total || '?'} generated steps · Phase: ${status.phase ?? 'setup'}</div>
        <div>Generated cases: ${generated}${hidden > 0 ? ` shown · ${hidden} duplicate cases collapsed` : ''}</div>
        <div>Generating cases from graph/assertion metadata, driving the graph, and checking assertions.</div>
        ${hasPreviousResult ? '<div>Showing the previous completed result until this run finishes.</div>' : ''}
      `;
      return box;
    }

    box.innerHTML = `
      <div style="font-weight:600;">Last ${label.toLowerCase()} run: #${status.number} ${status.status}</div>
      <div>Started: ${formatClock(status.startedAt)} · Finished: ${status.finishedAt ? formatClock(status.finishedAt) : 'n/a'} · Duration: ${formatDuration(status.durationMs)}</div>
      <div>Generated cases: ${status.generatedCases ?? 'n/a'} · Steps: ${status.steps ?? 'n/a'}${status.stoppedByBudget ? ' · stopped by budget' : ''}</div>
    `;
    return box;
  }

  function render() {
    if (disposed) return;
    container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:0.9rem; font-weight:600; color:#c9d1d9;';
    title.textContent = 'Autotest';

    const checkBtn = document.createElement('button');
    checkBtn.textContent = running
      ? (options?.autotest ? 'Running...' : 'Exploring...')
      : options?.autotest ? 'Run Autotest' : options?.explore ? 'Explore' : 'Check All';
    checkBtn.style.cssText = `background:#21262d; border:1px solid #30363d; color:#c9d1d9; padding:3px 10px; border-radius:4px; cursor:${options?.autotest || options?.explore ? 'pointer' : 'not-allowed'}; font-size:0.75rem;`;
    checkBtn.disabled = running || (!options?.autotest && !options?.explore);
    if (checkBtn.disabled) checkBtn.style.opacity = '0.55';
    checkBtn.addEventListener('click', runAutotestFromPanel);

    header.appendChild(title);
    header.appendChild(checkBtn);
    container.appendChild(header);

    if (activeRun) {
      container.appendChild(renderRunStatus(activeRun, lastRunResult !== null));
    } else if (lastRun) {
      container.appendChild(renderRunStatus(lastRun, false));
    }

    if (error) {
      const errorBox = document.createElement('div');
      errorBox.style.cssText = 'color:#ff5d8f; padding:8px; background:rgba(255,93,143,0.08); border:1px solid rgba(255,93,143,0.2); border-radius:4px; margin-bottom:10px;';
      errorBox.textContent = error;
      container.appendChild(errorBox);
    }

    // Autotest/explore results (if available)
    if (lastRunResult) {
      const resultBox = document.createElement('div');
      resultBox.style.cssText = 'margin-bottom:12px; padding:8px; background:rgba(255,255,255,0.03); border:1px solid #21262d; border-radius:4px; font-size:0.72rem;';
      const v = lastRunResult.violations;
      const s = lastRunResult.steps;
      const coverage = lastRunResult.coverage;
      const plan = lastRunResult.plan;
      const generatedCoverage = plan?.generatedReachableCoverage ?? coverage.overall;
      const status = 'status' in lastRunResult ? lastRunResult.status : (v.length > 0 ? 'failed' : 'passed');
      const generatedBy = isAutotestResult(lastRunResult)
        ? '@veriscope/test runAutotest generated these cases from the graph and assertion metadata.'
        : '@veriscope/test explore generated these cases from the graph and assertion metadata.';
      const determinismText = plan
        ? `${plan.deterministic ? 'deterministic' : 'seeded'}${plan.seed === undefined ? '' : ` · seed ${plan.seed}`} · ${plan.exhausted ? 'generated space exhausted' : 'stopped by budget'}`
        : 'deterministic · generated space status unavailable';
      resultBox.innerHTML = `
        <div style="color:#c9d1d9; margin-bottom:4px; font-weight:600;">Autotest Results</div>
        <div style="color:#8b949e;">Status: <span style="color:${status === 'failed' ? '#ff5d8f' : '#72f1b8'}">${status}</span> · Steps: ${s} · Violations: <span style="color:${v.length > 0 ? '#ff5d8f' : '#72f1b8'}">${v.length}</span></div>
        <div style="color:#8b949e; margin-top:4px;">Run: ${determinismText}${plan ? ` · budget ${plan.budget}` : ''}</div>
        <div style="color:#8b949e; margin-top:4px;">Generated reachable coverage: ${generatedCoverage.percentage.toFixed(1)}% (${generatedCoverage.covered}/${generatedCoverage.total})${plan?.stoppedByBudget ? ' · incomplete because the cap was reached' : ''}</div>
        <div style="color:#8b949e; margin-top:4px;">Runtime counters: toggles ${coverage.toggle.covered}/${coverage.toggle.total}, transitions ${coverage.transitions.covered}/${coverage.transitions.total}, cross ${coverage.cross.covered}/${coverage.cross.total}, operations ${coverage.operations.covered}/${coverage.operations.total}</div>
        <div style="color:#8b949e; margin-top:4px;">${generatedBy}</div>
        <div style="color:#8b949e; margin-top:4px;">Each case lists driven roots, propagated derived recomputes, temporal assertion events, and failed assertions when present.</div>
      `;
      if (plan) {
        const phaseLine = document.createElement('div');
        phaseLine.style.cssText = 'color:#8b949e; margin-top:4px; overflow-wrap:anywhere;';
        const phases = Object.entries(plan.phaseCounts)
          .filter(([, count]) => count > 0)
          .map(([phase, count]) => `${phase} ${count}`)
          .join(', ');
        phaseLine.textContent = `Cases: ${plan.generatedCases} shown${plan.hiddenDuplicateCases > 0 ? `, ${plan.hiddenDuplicateCases} duplicate generated cases collapsed` : ''}${phases ? ` · ${phases}` : ''}.`;
        resultBox.appendChild(phaseLine);
      }
      if (coverage.gaps.length > 0) {
        const gapList = document.createElement('div');
        gapList.style.cssText = 'color:#f8d66d; margin-top:4px; overflow-wrap:anywhere;';
        gapList.textContent = `Runtime counter gaps: ${coverage.gaps.slice(0, 6).map(gap =>
          `${gap.kind}:${gap.id} missing ${gap.missing.slice(0, 4).join('|')}${gap.missing.length > 4 ? '+more' : ''}`,
        ).join('; ')}${coverage.gaps.length > 6 ? `; +${coverage.gaps.length - 6} more gaps` : ''}`;
        resultBox.appendChild(gapList);
      }
      if (isAutotestResult(lastRunResult)) {
        const partials = lastRunResult.assertions.filter(assertion => assertion.partialCoverage);
        const partialLine = document.createElement('div');
        partialLine.style.cssText = `color:${partials.length > 0 ? '#f8d66d' : '#8b949e'}; margin-top:4px;`;
        partialLine.textContent = partials.length > 0
          ? `Partial assertions: ${partials.length} (${partials.map(assertion => assertion.name).join(', ')})`
          : 'Partial assertions: 0';
        resultBox.appendChild(partialLine);

        const assertionBox = document.createElement('div');
        assertionBox.style.cssText = 'margin-top:8px; border-top:1px solid rgba(255,255,255,0.06); padding-top:8px;';
        const assertionTitle = document.createElement('div');
        assertionTitle.style.cssText = 'color:#c9d1d9; margin-bottom:5px; font-weight:600;';
        const resultPassed = lastRunResult.assertions.filter(assertion => assertion.status === 'passed').length;
        const resultFailed = lastRunResult.assertions.filter(assertion => assertion.status === 'failed').length;
        assertionTitle.textContent = `Assertion Results (${resultPassed} passed, ${resultFailed} failed)`;
        assertionBox.appendChild(assertionTitle);

        for (const assertion of lastRunResult.assertions) {
          const row = document.createElement('div');
          row.style.cssText = `display:flex; align-items:center; gap:8px; padding:5px 6px; margin-top:4px; background:${assertion.status === 'failed' ? 'rgba(255,93,143,0.08)' : 'rgba(114,241,184,0.04)'}; border:1px solid ${assertion.status === 'failed' ? 'rgba(255,93,143,0.2)' : 'rgba(114,241,184,0.16)'}; border-radius:3px; font-size:0.68rem;`;
          const dot = document.createElement('span');
          dot.style.cssText = `width:8px; height:8px; border-radius:50%; flex-shrink:0; background:${assertion.status === 'failed' ? '#ff5d8f' : '#72f1b8'};`;
          const name = document.createElement('span');
          name.style.cssText = 'flex:1; color:#c9d1d9; overflow-wrap:anywhere;';
          name.textContent = assertion.name;
          const statusBadge = document.createElement('span');
          statusBadge.style.cssText = `color:${assertion.status === 'failed' ? '#ff5d8f' : '#72f1b8'}; white-space:nowrap;`;
          const scenarioCount = assertion.scenarioCount ?? 0;
          const exerciseText = assertion.exercised === false ? 'unhit' : `${scenarioCount} cases`;
          statusBadge.textContent = `${assertion.status}${assertion.partialCoverage ? ' · partial' : ''} · ${assertion.kind} · ${exerciseText}`;
          row.appendChild(dot);
          row.appendChild(name);
          row.appendChild(statusBadge);
          assertionBox.appendChild(row);
          if (assertion.partialCoverage && assertion.reason) {
            const reason = document.createElement('div');
            reason.style.cssText = 'color:#f8d66d; margin:-1px 0 4px 22px; font-size:0.64rem; overflow-wrap:anywhere;';
            reason.textContent = assertion.reason;
            assertionBox.appendChild(reason);
          }
        }

        resultBox.appendChild(assertionBox);
      }
      if (v.length > 0) {
        const list = document.createElement('div');
        list.style.cssText = 'margin-top:6px;';
        const byAssertion = new Map<string, typeof v>();
        for (const viol of v) {
          const entries = byAssertion.get(viol.assertionName) ?? [];
          entries.push(viol);
          byAssertion.set(viol.assertionName, entries);
        }
        for (const [assertionName, entries] of byAssertion) {
          const item = document.createElement('div');
          item.style.cssText = 'padding:6px 8px; margin-top:4px; background:rgba(255,93,143,0.08); border:1px solid rgba(255,93,143,0.2); border-radius:3px; font-size:0.68rem;';
          const examples = entries.slice(0, 3).map(viol => {
            const vals = Object.entries(viol.signalValues).map(([key, value]) => `${key}=${formatScenarioValue(value)}`).join(', ');
            return `tick ${viol.tick}${vals ? ` [${vals}]` : ''}`;
          }).join(' · ');
          item.innerHTML = `
            <div><span style="color:#ff5d8f;">${assertionName}</span> <span style="color:#8b949e;">failed ${entries.length} case${entries.length === 1 ? '' : 's'}</span></div>
            <div style="color:#666; margin-top:2px; overflow-wrap:anywhere;">${examples}${entries.length > 3 ? ` · +${entries.length - 3} more` : ''}</div>
          `;
          list.appendChild(item);
        }
        resultBox.appendChild(list);
      }
      if (lastRunResult.scenarios.length > 0) {
        const passingScenarios = lastRunResult.scenarios.filter(scenario => scenario.violations.length === 0);
        const failingScenarios = lastRunResult.scenarios.filter(scenario => scenario.violations.length > 0);
        const evidenceScenarios = lastRunResult.scenarios.filter(scenario =>
          scenario.kind === 'sequence'
          || scenario.kind === 'coverage-directed'
          || scenario.observations?.some(obs =>
            obs.type === 'derived-recompute'
            || obs.type === 'assertion-armed'
            || obs.type === 'assertion-failed'
            || obs.type.startsWith('operation-'),
          ),
        );
        const scenarioBox = document.createElement('div');
        scenarioBox.style.cssText = 'margin-top:8px; border-top:1px solid rgba(255,255,255,0.06); padding-top:8px;';
        const scenarioTitle = document.createElement('div');
        scenarioTitle.style.cssText = 'color:#c9d1d9; margin-bottom:5px; font-weight:600;';
        scenarioTitle.textContent = `Generated Cases (${passingScenarios.length} passed, ${failingScenarios.length} failed)`;
        scenarioBox.appendChild(scenarioTitle);

        if (evidenceScenarios.length > 0) {
          const evidenceTitle = document.createElement('div');
          evidenceTitle.style.cssText = 'color:#a78bfa; margin-top:6px; font-weight:600;';
          evidenceTitle.textContent = `Evidence Cases (${evidenceScenarios.length})`;
          scenarioBox.appendChild(evidenceTitle);
          const evidenceNote = document.createElement('div');
          evidenceNote.style.cssText = 'color:#8b949e; margin-top:3px; font-size:0.66rem; line-height:1.4;';
          evidenceNote.textContent = 'Evidence cases are generated cases with useful proof signals: temporal events, coverage-directed drives, propagation, or failures. They are not hand-written tests.';
          scenarioBox.appendChild(evidenceNote);
          for (const scenario of evidenceScenarios.slice(0, 8)) {
            scenarioBox.appendChild(renderScenarioItem(scenario));
          }
        }

        const passingTitle = document.createElement('div');
        passingTitle.style.cssText = 'color:#72f1b8; margin-top:6px; font-weight:600;';
        passingTitle.textContent = `Passing Cases (${passingScenarios.length})`;
        scenarioBox.appendChild(passingTitle);
        for (const scenario of passingScenarios.slice(0, 5)) {
          scenarioBox.appendChild(renderScenarioItem(scenario));
        }

        const failingTitle = document.createElement('div');
        failingTitle.style.cssText = 'color:#ff5d8f; margin-top:8px; font-weight:600;';
        failingTitle.textContent = `Failing Cases (${failingScenarios.length})`;
        scenarioBox.appendChild(failingTitle);
        for (const scenario of failingScenarios.slice(0, 5)) {
          scenarioBox.appendChild(renderScenarioItem(scenario));
        }

        const hiddenCount = Math.max(0, passingScenarios.length - 5) + Math.max(0, failingScenarios.length - 5);
        if (hiddenCount > 0) {
          const more = document.createElement('div');
          more.style.cssText = 'color:#666; margin-top:5px;';
          more.textContent = `Showing 5 passing and 5 failing cases where available; ${hiddenCount} additional cases hidden.`;
          scenarioBox.appendChild(more);
        }

        resultBox.appendChild(scenarioBox);
      }
      container.appendChild(resultBox);
    } else {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#666; padding:20px; text-align:center;';
      empty.textContent = options?.autotest || options?.explore
        ? 'No autotest run yet.'
        : 'No autotest runner registered.';
      container.appendChild(empty);
    }
  }

  render();

  return {
    dispose() {
      disposed = true;
      stopLiveTimer();
      container.innerHTML = '';
    },
    refresh() {
      render();
    },
  };
}
