// coverage.ts — Coverage display panel: toggle coverage matrix, transition map, cross coverage

import type { CoverageCollector, CoverageReport } from '@veriscope/graph';

export function createCoveragePanel(
  container: HTMLElement,
  collector: CoverageCollector,
): { dispose: () => void; refresh: () => void } {
  container.style.cssText = 'height:100%; overflow-y:auto; padding:12px; font-family:"SF Mono","Fira Code",monospace; font-size:0.8rem;';

  let disposed = false;

  function render() {
    if (disposed) return;
    container.innerHTML = '';

    const report = collector.getReport();

    // --- Header ---
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:0.9rem; font-weight:600; color:#c9d1d9;';
    title.textContent = 'Coverage';

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = collector.isEnabled() ? 'Disable' : 'Enable';
    toggleBtn.style.cssText = `background:${collector.isEnabled() ? '#1a3a2a' : '#21262d'}; border:1px solid ${collector.isEnabled() ? '#2ea043' : '#30363d'}; color:#c9d1d9; padding:3px 10px; border-radius:4px; cursor:pointer; font-size:0.75rem;`;
    toggleBtn.addEventListener('click', () => {
      if (collector.isEnabled()) collector.disable();
      else collector.enable();
      render();
    });

    header.appendChild(title);
    header.appendChild(toggleBtn);
    container.appendChild(header);

    // --- Summary bar ---
    const pct = report.summary.percentage;
    const summaryBar = document.createElement('div');
    summaryBar.style.cssText = 'margin-bottom:16px;';
    const barBg = document.createElement('div');
    barBg.style.cssText = 'height:16px; background:#161b22; border-radius:8px; overflow:hidden; border:1px solid #21262d; position:relative;';
    const barFill = document.createElement('div');
    const barColor = pct >= 80 ? '#72f1b8' : pct >= 50 ? '#f8d66d' : '#ff5d8f';
    barFill.style.cssText = `height:100%; background:${barColor}; width:${pct}%; transition:width 0.3s; opacity:0.6;`;
    barBg.appendChild(barFill);
    const barLabel = document.createElement('div');
    barLabel.style.cssText = 'position:absolute; top:0; left:0; right:0; bottom:0; display:flex; align-items:center; justify-content:center; font-size:0.7rem; color:#c9d1d9;';
    barLabel.textContent = `${pct.toFixed(1)}% (${report.summary.coveredPoints}/${report.summary.totalPoints})`;
    barBg.appendChild(barLabel);
    summaryBar.appendChild(barBg);
    container.appendChild(summaryBar);

    // --- Toggle coverage matrix ---
    if (report.toggle.length > 0) {
      const section = document.createElement('div');
      section.style.cssText = 'margin-bottom:16px;';
      const sectionTitle = document.createElement('div');
      sectionTitle.style.cssText = 'font-size:0.8rem; font-weight:600; color:#c9d1d9; margin-bottom:8px;';
      sectionTitle.textContent = 'Toggle Coverage';
      section.appendChild(sectionTitle);

      const table = document.createElement('div');
      table.style.cssText = 'display:grid; grid-template-columns:1fr 60px 60px; gap:1px; background:#21262d; border:1px solid #21262d; border-radius:4px; overflow:hidden;';

      // Header row
      for (const text of ['Signal', 'True', 'False']) {
        const cell = document.createElement('div');
        cell.style.cssText = 'padding:4px 8px; background:#161b22; color:#666; font-size:0.7rem; font-weight:600;';
        cell.textContent = text;
        table.appendChild(cell);
      }

      for (const t of report.toggle) {
        // Signal name
        const nameCell = document.createElement('div');
        nameCell.style.cssText = 'padding:4px 8px; background:#0d1117; color:#c9d1d9; font-size:0.75rem;';
        nameCell.textContent = t.signalId;
        table.appendChild(nameCell);

        // True cell
        const trueCell = document.createElement('div');
        trueCell.style.cssText = `padding:4px 8px; background:#0d1117; text-align:center; font-size:0.75rem; color:${t.seenTrue ? '#72f1b8' : '#444'};`;
        trueCell.textContent = t.seenTrue ? '\u2713' : '\u2014';
        table.appendChild(trueCell);

        // False cell
        const falseCell = document.createElement('div');
        falseCell.style.cssText = `padding:4px 8px; background:#0d1117; text-align:center; font-size:0.75rem; color:${t.seenFalse ? '#72f1b8' : '#444'};`;
        falseCell.textContent = t.seenFalse ? '\u2713' : '\u2014';
        table.appendChild(falseCell);
      }

      section.appendChild(table);
      container.appendChild(section);
    }

    // --- Transition coverage ---
    if (report.transitions.length > 0) {
      const section = document.createElement('div');
      section.style.cssText = 'margin-bottom:16px;';
      const sectionTitle = document.createElement('div');
      sectionTitle.style.cssText = 'font-size:0.8rem; font-weight:600; color:#c9d1d9; margin-bottom:8px;';
      sectionTitle.textContent = 'Observed / Planned Transitions';
      section.appendChild(sectionTitle);

      for (const tc of report.transitions) {
        const fsmLabel = document.createElement('div');
        fsmLabel.style.cssText = 'color:#a78bfa; font-size:0.75rem; margin-bottom:4px;';
        const planned = tc.plannedTransitions ?? new Set<string>();
        fsmLabel.textContent = `${tc.fsmId} (${tc.transitions.size} observed${planned.size > 0 ? `, ${planned.size} planned` : ''})`;
        section.appendChild(fsmLabel);

        const states = [...tc.states];
        // Build transition matrix
        const grid = document.createElement('div');
        grid.style.cssText = `display:grid; grid-template-columns:80px repeat(${states.length}, 60px); gap:1px; background:#21262d; border:1px solid #21262d; border-radius:4px; overflow:hidden; margin-bottom:8px;`;

        // Header row
        const corner = document.createElement('div');
        corner.style.cssText = 'padding:3px 4px; background:#161b22; color:#666; font-size:0.65rem;';
        corner.textContent = 'From \\ To';
        grid.appendChild(corner);
        for (const s of states) {
          const cell = document.createElement('div');
          cell.style.cssText = 'padding:3px 4px; background:#161b22; color:#666; font-size:0.65rem; text-align:center;';
          cell.textContent = s;
          grid.appendChild(cell);
        }

        // Data rows
        for (const from of states) {
          const rowLabel = document.createElement('div');
          rowLabel.style.cssText = 'padding:3px 4px; background:#0d1117; color:#c9d1d9; font-size:0.65rem;';
          rowLabel.textContent = from;
          grid.appendChild(rowLabel);
          for (const to of states) {
            const key = `${from}->${to}`;
            const count = tc.transitions.get(key) ?? 0;
            const isPlanned = planned.size === 0 || planned.has(key);
            const cell = document.createElement('div');
            cell.style.cssText = `padding:3px 4px; background:#0d1117; text-align:center; font-size:0.65rem; color:${count > 0 ? '#72f1b8' : isPlanned ? '#f8d66d' : '#333'};`;
            cell.textContent = count > 0 ? String(count) : isPlanned ? '0' : '\u2014';
            grid.appendChild(cell);
          }
        }

        section.appendChild(grid);
      }

      container.appendChild(section);
    }

    // --- Numeric activity ---
    if ((report.numericActivity ?? []).length > 0) {
      const section = document.createElement('div');
      section.style.cssText = 'margin-bottom:16px;';
      const sectionTitle = document.createElement('div');
      sectionTitle.style.cssText = 'font-size:0.8rem; font-weight:600; color:#c9d1d9; margin-bottom:8px;';
      sectionTitle.textContent = 'Numeric Activity';
      section.appendChild(sectionTitle);

      const table = document.createElement('div');
      table.style.cssText = 'display:grid; grid-template-columns:1fr 70px 90px 80px; gap:1px; background:#21262d; border:1px solid #21262d; border-radius:4px; overflow:hidden;';
      for (const text of ['Signal', 'Samples', 'Range', 'Step']) {
        const cell = document.createElement('div');
        cell.style.cssText = 'padding:4px 8px; background:#161b22; color:#666; font-size:0.7rem; font-weight:600;';
        cell.textContent = text;
        table.appendChild(cell);
      }

      for (const item of report.numericActivity ?? []) {
        const cells = [
          item.signalId,
          String(item.samples),
          `${item.min}..${item.max}`,
          `max ${item.largestStep}`,
        ];
        for (const [index, text] of cells.entries()) {
          const cell = document.createElement('div');
          cell.style.cssText = `padding:4px 8px; background:#0d1117; color:${index === 0 ? '#c9d1d9' : '#8b949e'}; font-size:0.75rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`;
          cell.textContent = text;
          cell.title = text;
          table.appendChild(cell);
        }
      }

      section.appendChild(table);
      container.appendChild(section);
    }

    // --- Cross coverage ---
    if (report.cross.length > 0) {
      const section = document.createElement('div');
      section.style.cssText = 'margin-bottom:16px;';
      const sectionTitle = document.createElement('div');
      sectionTitle.style.cssText = 'font-size:0.8rem; font-weight:600; color:#c9d1d9; margin-bottom:8px;';
      sectionTitle.textContent = 'Cross Coverage';
      section.appendChild(sectionTitle);

      for (const cc of report.cross) {
        const groupLabel = document.createElement('div');
        groupLabel.style.cssText = 'color:#6ee7f9; font-size:0.75rem; margin-bottom:4px;';
        groupLabel.textContent = `${cc.groupId} (${cc.observed.size}/${cc.total} bins)`;
        section.appendChild(groupLabel);

        const binGrid = document.createElement('div');
        binGrid.style.cssText = 'display:flex; flex-wrap:wrap; gap:2px; margin-bottom:8px;';
        // Show all possible combos as small cells
        const n = cc.signals.length;
        const totalCombos = Math.pow(2, n);
        for (let i = 0; i < totalCombos && i < 64; i++) {
          const key = Array.from({ length: n }, (_, bit) => (i >> (n - 1 - bit)) & 1 ? '1' : '0').join(',');
          const count = cc.observed.get(key) ?? 0;
          const cell = document.createElement('div');
          cell.style.cssText = `width:16px; height:16px; border-radius:2px; background:${count > 0 ? '#72f1b8' : '#1a1e26'}; opacity:${count > 0 ? '0.8' : '0.3'}; border:1px solid #21262d;`;
          cell.title = `${key}: ${count}x`;
          binGrid.appendChild(cell);
        }
        section.appendChild(binGrid);
      }

      container.appendChild(section);
    }

    // Empty state
    if (report.toggle.length === 0 && report.transitions.length === 0 && report.cross.length === 0 && (report.numericActivity ?? []).length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#666; padding:20px; text-align:center;';
      empty.textContent = collector.isEnabled()
        ? 'No coverage data yet. Interact with the app to generate coverage.'
        : 'Coverage collection is disabled. Click Enable to start.';
      container.appendChild(empty);
    }
  }

  render();

  return {
    dispose() { disposed = true; container.innerHTML = ''; },
    refresh() { render(); },
  };
}
