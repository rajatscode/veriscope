// assertions.ts — Autotest panel: generated scenarios, assertion outcomes, and coverage from explicit runs

import type { CircuitGraph } from '@veriscope/graph';
import type { AutotestResult, ExploreResult } from './index.js';

interface AssertionsPanelOptions {
  autotest?: (graph: CircuitGraph, options?: { budget?: number; flush?: () => void | Promise<void>; name?: string }) => Promise<AutotestResult>;
  explore?: (graph: CircuitGraph, options?: { budget?: number; flush?: () => void | Promise<void> }) => Promise<ExploreResult>;
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

function renderScenarioItem(scenario: ExploreResult['scenarios'][number]): HTMLElement {
  const item = document.createElement('div');
  item.style.cssText = 'padding:5px 6px; margin-top:4px; background:rgba(255,255,255,0.025); border:1px solid #21262d; border-radius:3px; font-size:0.68rem;';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex; justify-content:space-between; gap:8px; color:#8b949e;';
  const left = document.createElement('span');
  left.textContent = `${scenario.id} · ${scenario.kind}`;
  const right = document.createElement('span');
  right.style.cssText = scenario.violations.length > 0 ? 'color:#ff5d8f;' : 'color:#72f1b8;';
  right.textContent = scenario.violations.length > 0 ? `${scenario.violations.length} violations` : 'passed';
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
    checkBtn.textContent = options?.autotest ? 'Run Autotest' : options?.explore ? 'Explore' : 'Check All';
    checkBtn.style.cssText = `background:#21262d; border:1px solid #30363d; color:#c9d1d9; padding:3px 10px; border-radius:4px; cursor:${options?.autotest || options?.explore ? 'pointer' : 'not-allowed'}; font-size:0.75rem;`;
    checkBtn.disabled = !options?.autotest && !options?.explore;
    if (checkBtn.disabled) checkBtn.style.opacity = '0.55';
    checkBtn.addEventListener('click', async () => {
      if (options?.autotest || options?.explore) {
        checkBtn.textContent = options?.autotest ? 'Running...' : 'Exploring...';
        checkBtn.style.opacity = '0.6';
        checkBtn.style.pointerEvents = 'none';
        try {
          lastRunResult = options?.autotest
            ? await options.autotest(graph, {
              budget: 1000,
              name: 'devtools-autotest',
              flush: async () => { await new Promise(r => setTimeout(r, 0)); },
            })
            : await options.explore!(graph, {
              budget: 1000,
              flush: async () => { await new Promise(r => setTimeout(r, 0)); },
            });
          render();
        } catch (err) {
          console.error('[Veriscope] autotest failed:', err);
          checkBtn.textContent = options?.autotest ? 'Run Autotest' : 'Explore';
          checkBtn.style.opacity = '1';
          checkBtn.style.pointerEvents = '';
        }
      }
    });

    header.appendChild(title);
    header.appendChild(checkBtn);
    container.appendChild(header);

    // Autotest/explore results (if available)
    if (lastRunResult) {
      const resultBox = document.createElement('div');
      resultBox.style.cssText = 'margin-bottom:12px; padding:8px; background:rgba(255,255,255,0.03); border:1px solid #21262d; border-radius:4px; font-size:0.72rem;';
      const v = lastRunResult.violations;
      const s = lastRunResult.steps;
      const coverage = lastRunResult.coverage;
      const status = 'status' in lastRunResult ? lastRunResult.status : (v.length > 0 ? 'failed' : 'passed');
      resultBox.innerHTML = `
        <div style="color:#c9d1d9; margin-bottom:4px; font-weight:600;">Autotest Results</div>
        <div style="color:#8b949e;">Status: <span style="color:${status === 'failed' ? '#ff5d8f' : '#72f1b8'}">${status}</span> · Steps: ${s} · Violations: <span style="color:${v.length > 0 ? '#ff5d8f' : '#72f1b8'}">${v.length}</span></div>
        <div style="color:#8b949e; margin-top:4px;">Coverage: ${coverage.overall.percentage.toFixed(1)}% (${coverage.overall.covered}/${coverage.overall.total}) · Gaps: ${coverage.gaps.length}</div>
      `;
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
        }

        resultBox.appendChild(assertionBox);
      }
      if (v.length > 0) {
        const list = document.createElement('div');
        list.style.cssText = 'margin-top:6px;';
        for (const viol of v) {
          const item = document.createElement('div');
          item.style.cssText = 'padding:4px 6px; margin-top:3px; background:rgba(255,93,143,0.08); border:1px solid rgba(255,93,143,0.2); border-radius:3px; font-size:0.68rem;';
          const vals = Object.entries(viol.signalValues).map(([k, v]) => `${k}=${v}`).join(', ');
          item.innerHTML = `<span style="color:#ff5d8f;">${viol.assertionName}</span> <span style="color:#666;">tick ${viol.tick}</span>${vals ? ` <span style="color:#8b949e;">[${vals}]</span>` : ''}`;
          list.appendChild(item);
        }
        resultBox.appendChild(list);
      }
      if (lastRunResult.scenarios.length > 0) {
        const passingScenarios = lastRunResult.scenarios.filter(scenario => scenario.violations.length === 0);
        const failingScenarios = lastRunResult.scenarios.filter(scenario => scenario.violations.length > 0);
        const scenarioBox = document.createElement('div');
        scenarioBox.style.cssText = 'margin-top:8px; border-top:1px solid rgba(255,255,255,0.06); padding-top:8px;';
        const scenarioTitle = document.createElement('div');
        scenarioTitle.style.cssText = 'color:#c9d1d9; margin-bottom:5px; font-weight:600;';
        scenarioTitle.textContent = `Generated Cases (${passingScenarios.length} passed, ${failingScenarios.length} failed)`;
        scenarioBox.appendChild(scenarioTitle);

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
      container.innerHTML = '';
    },
    refresh() {
      render();
    },
  };
}
