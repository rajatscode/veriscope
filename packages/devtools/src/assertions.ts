// assertions.ts — Assertion monitor panel: live pass/fail status for all assertions

import type { CircuitGraph, CoverageCollector, GraphEvent } from '@veriscope/graph';
import type { AutotestResult, ExploreResult } from './index.js';

interface AssertionEntry {
  nodeId: string;
  name: string;
  kind: string;
  status: 'unknown' | 'armed' | 'passed' | 'failed';
  lastTick: number;
  failCount: number;
  passCount: number;
}

interface AssertionsPanelOptions {
  autotest?: (graph: CircuitGraph, options?: { budget?: number; flush?: () => void | Promise<void>; name?: string }) => Promise<AutotestResult>;
  explore?: (graph: CircuitGraph, options?: { budget?: number; flush?: () => void | Promise<void> }) => Promise<ExploreResult>;
  coverage?: CoverageCollector;
}

function isAutotestResult(result: AutotestResult | ExploreResult): result is AutotestResult {
  return Array.isArray((result as Partial<AutotestResult>).assertions);
}

export function createAssertionsPanel(
  container: HTMLElement,
  graph: CircuitGraph,
  options?: AssertionsPanelOptions,
): { dispose: () => void; refresh: () => void } {
  container.style.cssText = 'height:100%; overflow-y:auto; padding:12px; font-family:"SF Mono","Fira Code",monospace; font-size:0.8rem;';

  const entries = new Map<string, AssertionEntry>();
  let unsubscribe: (() => void) | null = null;
  let disposed = false;
  let lastRunResult: AutotestResult | ExploreResult | null = null;
  let renderScheduled = false;

  function scheduleRender() {
    if (disposed || renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      render();
    });
  }

  function buildEntries() {
    const assertions = graph.getAssertions();
    // Preserve existing stats
    const existing = new Map(entries);
    entries.clear();
    for (const node of assertions) {
      const prev = existing.get(node.id);
      entries.set(node.id, {
        nodeId: node.id,
        name: node.name,
        kind: node.kind ?? 'unknown',
        status: prev?.status ?? 'unknown',
        lastTick: prev?.lastTick ?? 0,
        failCount: prev?.failCount ?? 0,
        passCount: prev?.passCount ?? 0,
      });
    }
  }

  function handleEvent(event: GraphEvent) {
    if (event.type === 'assertion-armed' || event.type === 'assertion-passed' || event.type === 'assertion-failed') {
      let entry = entries.get(event.nodeId);
      if (!entry) {
        const node = graph.getNode(event.nodeId);
        if (!node) return;
        entry = {
          nodeId: event.nodeId,
          name: node.name,
          kind: node.assertionKind ?? 'unknown',
          status: 'unknown',
          lastTick: 0,
          failCount: 0,
          passCount: 0,
        };
        entries.set(event.nodeId, entry);
      }
      entry.lastTick = event.tick;
      if (event.type === 'assertion-armed') entry.status = 'armed';
      else if (event.type === 'assertion-passed') { entry.status = 'passed'; entry.passCount++; }
      else if (event.type === 'assertion-failed') { entry.status = 'failed'; entry.failCount++; }
      render();
    } else if (
      event.operationId ||
      event.type === 'operation-begin' ||
      event.type === 'operation-resolve' ||
      event.type === 'operation-reject' ||
      event.type === 'operation-abort' ||
      event.type === 'operation-timeout' ||
      event.type === 'operation-stale' ||
      (options?.coverage && (event.type === 'signal-change' || event.type === 'derived-recompute'))
    ) {
      scheduleRender();
    }
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
    checkBtn.textContent = options?.autotest ? 'Run Autotest' : options?.explore ? 'Explore' : 'Check All';
    checkBtn.style.cssText = 'background:#21262d; border:1px solid #30363d; color:#c9d1d9; padding:3px 10px; border-radius:4px; cursor:pointer; font-size:0.75rem;';
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
          buildEntries();
          if (isAutotestResult(lastRunResult)) {
            for (const assertion of lastRunResult.assertions) {
              const entry = entries.get(assertion.id);
              if (!entry) continue;
              entry.status = assertion.status;
              if (assertion.status === 'failed') entry.failCount++;
              else entry.passCount++;
            }
          }
          render();
        } catch (err) {
          console.error('[Veriscope] autotest failed:', err);
          checkBtn.textContent = options?.autotest ? 'Run Autotest' : 'Explore';
          checkBtn.style.opacity = '1';
          checkBtn.style.pointerEvents = '';
        }
      } else {
        graph.checkAssertions();
        render();
      }
    });

    header.appendChild(title);
    header.appendChild(checkBtn);
    container.appendChild(header);

    // Summary
    const allEntries = [...entries.values()];
    const passed = allEntries.filter(e => e.status === 'passed').length;
    const failed = allEntries.filter(e => e.status === 'failed').length;
    const armed = allEntries.filter(e => e.status === 'armed').length;
    const unknown = allEntries.filter(e => e.status === 'unknown').length;

    const summary = document.createElement('div');
    summary.style.cssText = 'display:flex; gap:12px; margin-bottom:16px; font-size:0.75rem; flex-wrap:wrap;';
    summary.innerHTML = `
      <span style="color:#72f1b8">${passed} passed</span>
      <span style="color:#ff5d8f">${failed} failed</span>
      <span style="color:#f8d66d">${armed} armed</span>
      <span style="color:#666">${unknown} unchecked</span>
    `;
    container.appendChild(summary);

    if (options?.coverage && !lastRunResult) {
      const report = options.coverage.getReport();
      const coverageBox = document.createElement('div');
      coverageBox.style.cssText = 'margin-bottom:12px; padding:8px; background:rgba(255,255,255,0.03); border:1px solid #21262d; border-radius:4px; font-size:0.72rem;';
      coverageBox.innerHTML = `
        <div style="color:#c9d1d9; margin-bottom:4px; font-weight:600;">Runtime Coverage</div>
        <div style="color:#8b949e;">Coverage: ${report.summary.percentage.toFixed(1)}% (${report.summary.coveredPoints}/${report.summary.totalPoints}) · Gaps: ${report.gaps.length}</div>
      `;
      container.appendChild(coverageBox);
    }

    const operations = graph.getOperations();
    if (operations.length > 0) {
      const opsBox = document.createElement('div');
      opsBox.style.cssText = 'margin-bottom:12px; padding:8px; background:rgba(255,255,255,0.03); border:1px solid #21262d; border-radius:4px; font-size:0.72rem;';

      const opsTitle = document.createElement('div');
      opsTitle.style.cssText = 'color:#c9d1d9; margin-bottom:6px; font-weight:600;';
      opsTitle.textContent = `Operations (${operations.length})`;
      opsBox.appendChild(opsTitle);

      for (const op of operations.slice(-8).reverse()) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; justify-content:space-between; gap:8px; padding:4px 0; border-top:1px solid rgba(255,255,255,0.04); color:#8b949e;';
        const statusColor =
          op.status === 'resolved' ? '#72f1b8' :
          op.status === 'pending' ? '#f8d66d' :
          op.status === 'stale' || op.status === 'timeout' || op.status === 'rejected' ? '#ff5d8f' : '#8b949e';

        const label = document.createElement('span');
        label.textContent = `${op.name} · ${op.id}`;
        const detail = document.createElement('span');
        detail.style.cssText = `color:${statusColor}; white-space:nowrap;`;
        detail.textContent = `${op.status} · ticks ${op.startedAtTick}${op.completedAtTick === undefined ? '' : `-${op.completedAtTick}`} · ${op.events.length} events`;
        row.appendChild(label);
        row.appendChild(detail);
        opsBox.appendChild(row);
      }

      container.appendChild(opsBox);
    }

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
      container.appendChild(resultBox);
    }

    if (allEntries.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#666; padding:20px; text-align:center;';
      empty.textContent = 'No assertions registered. Use assertAlways(), assertNever(), or assertAfter() to add assertions.';
      container.appendChild(empty);
      return;
    }

    // Assertion rows
    for (const entry of allEntries) {
      const row = document.createElement('div');
      row.style.cssText = `
        display:flex; align-items:center; gap:8px; padding:6px 8px;
        background:${entry.status === 'failed' ? 'rgba(255,93,143,0.08)' : 'rgba(255,255,255,0.02)'};
        border:1px solid ${entry.status === 'failed' ? 'rgba(255,93,143,0.2)' : '#21262d'};
        border-radius:4px; margin-bottom:4px;
      `;

      // Status indicator
      const indicator = document.createElement('span');
      const statusColor =
        entry.status === 'passed' ? '#72f1b8' :
        entry.status === 'failed' ? '#ff5d8f' :
        entry.status === 'armed' ? '#f8d66d' : '#444';
      indicator.style.cssText = `width:10px; height:10px; border-radius:50%; background:${statusColor}; flex-shrink:0;`;

      // Name
      const name = document.createElement('span');
      name.style.cssText = 'flex:1; color:#c9d1d9; font-size:0.78rem;';
      name.textContent = entry.name;

      // Kind badge
      const kind = document.createElement('span');
      kind.style.cssText = 'color:#666; font-size:0.65rem; background:rgba(255,255,255,0.05); padding:1px 4px; border-radius:2px;';
      kind.textContent = entry.kind;

      // Stats
      const stats = document.createElement('span');
      stats.style.cssText = 'color:#666; font-size:0.65rem; min-width:80px; text-align:right;';
      stats.textContent = `P:${entry.passCount} F:${entry.failCount}`;

      row.appendChild(indicator);
      row.appendChild(name);
      row.appendChild(kind);
      row.appendChild(stats);
      container.appendChild(row);
    }
  }

  buildEntries();
  unsubscribe = graph.subscribe(handleEvent);
  render();

  return {
    dispose() {
      disposed = true;
      if (unsubscribe) unsubscribe();
      container.innerHTML = '';
    },
    refresh() {
      buildEntries();
      render();
    },
  };
}
