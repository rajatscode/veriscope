// assertions.ts — Assertion monitor panel: live pass/fail status for all assertions

import type { CircuitGraph, GraphEvent } from '@veriscope/graph';
import type { ExploreResult } from './index.js';

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
  explore?: (graph: CircuitGraph, options?: { budget?: number; flush?: () => void | Promise<void> }) => Promise<ExploreResult>;
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
  let lastExploreResult: ExploreResult | null = null;

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
    title.textContent = 'Assertions';

    const checkBtn = document.createElement('button');
    checkBtn.textContent = options?.explore ? 'Explore' : 'Check All';
    checkBtn.style.cssText = 'background:#21262d; border:1px solid #30363d; color:#c9d1d9; padding:3px 10px; border-radius:4px; cursor:pointer; font-size:0.75rem;';
    checkBtn.addEventListener('click', async () => {
      if (options?.explore) {
        checkBtn.textContent = 'Exploring...';
        checkBtn.style.opacity = '0.6';
        checkBtn.style.pointerEvents = 'none';
        try {
          lastExploreResult = await options.explore(graph, {
            budget: 1000,
            flush: async () => { await new Promise(r => setTimeout(r, 0)); },
          });
          buildEntries();
          render();
        } catch (err) {
          console.error('[Veriscope] explore() failed:', err);
          checkBtn.textContent = 'Explore';
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

    // Explore results (if available)
    if (lastExploreResult) {
      const resultBox = document.createElement('div');
      resultBox.style.cssText = 'margin-bottom:12px; padding:8px; background:rgba(255,255,255,0.03); border:1px solid #21262d; border-radius:4px; font-size:0.72rem;';
      const v = lastExploreResult.violations;
      const s = lastExploreResult.steps;
      resultBox.innerHTML = `
        <div style="color:#c9d1d9; margin-bottom:4px; font-weight:600;">Exploration Results</div>
        <div style="color:#8b949e;">Steps: ${s} · Violations: <span style="color:${v.length > 0 ? '#ff5d8f' : '#72f1b8'}">${v.length}</span></div>
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
