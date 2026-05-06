// reporter.ts — Formats CoverageReport as JSON/HTML/console

import type { CoverageReport } from '@veriscope/graph';

/**
 * Format a coverage report for console output with aligned columns.
 */
export function formatConsole(report: CoverageReport): string {
  const lines: string[] = [];

  lines.push('=== Veriscope Reactive Coverage Report ===');
  lines.push('');

  // Toggle coverage
  lines.push('--- Toggle Coverage ---');
  if (report.toggle.length === 0) {
    lines.push('  (no toggle coverage points)');
  } else {
    lines.push('  Signal            True   False  Covered');
    lines.push('  ──────────────────────────────────────');
    for (const t of report.toggle) {
      const covered = t.seenTrue && t.seenFalse;
      const trueStr = t.seenTrue ? '  ✓  ' : '  ✗  ';
      const falseStr = t.seenFalse ? '  ✓  ' : '  ✗  ';
      const covStr = covered ? '  YES' : '  NO ';
      lines.push(`  ${t.signalId.padEnd(18)}${trueStr}  ${falseStr}  ${covStr}`);
    }
  }
  lines.push('');

  // Transition coverage
  lines.push('--- Transition (FSM) Coverage ---');
  if (report.transitions.length === 0) {
    lines.push('  (no FSM coverage points)');
  } else {
    for (const fsm of report.transitions) {
      const planned = fsm.plannedTransitions ?? new Set<string>();
      const totalPossible = planned.size > 0 ? planned.size : fsm.transitions.size;
      const observed = fsm.transitions.size;
      const label = planned.size > 0 ? 'planned transitions' : 'observed transitions';
      lines.push(`  FSM: ${fsm.fsmId}  (${observed}/${totalPossible} ${label})`);
      for (const [trans, count] of fsm.transitions) {
        lines.push(`    ${trans}  ×${count}`);
      }
      for (const trans of planned) {
        if (!fsm.transitions.has(trans)) lines.push(`    ${trans}  missing`);
      }
    }
  }
  lines.push('');

  // Numeric activity
  lines.push('--- Numeric Activity ---');
  if ((report.numericActivity ?? []).length === 0) {
    lines.push('  (no numeric counter/gauge activity)');
  } else {
    lines.push('  Signal            Samples  Range         Direction');
    lines.push('  ─────────────────────────────────────────────────');
    for (const item of report.numericActivity ?? []) {
      const direction =
        item.increments > 0 && item.decrements > 0 ? 'mixed' :
        item.increments > 0 ? 'up' :
        item.decrements > 0 ? 'down' : 'flat';
      lines.push(`  ${item.signalId.padEnd(18)}${String(item.samples).padEnd(9)}${`${item.min}..${item.max}`.padEnd(14)}${direction}`);
    }
  }
  lines.push('');

  // Cross coverage
  lines.push('--- Cross Coverage ---');
  if (report.cross.length === 0) {
    lines.push('  (no cross coverage groups)');
  } else {
    for (const group of report.cross) {
      const pct = group.total > 0 ? ((group.observed.size / group.total) * 100).toFixed(1) : '0.0';
      lines.push(`  Group: ${group.groupId}  [${group.signals.join(', ')}]`);
      lines.push(`    ${group.observed.size}/${group.total} combinations observed (${pct}%)`);
      for (const [combo, count] of group.observed) {
        lines.push(`    [${combo}]  ×${count}`);
      }
    }
  }
  lines.push('');

  // Operation outcome coverage
  lines.push('--- Operation Outcome Coverage ---');
  if (report.operations.length === 0) {
    lines.push('  (no operation outcome coverage)');
  } else {
    for (const op of report.operations) {
      const declared = [...op.declaredOutcomes];
      const covered = declared.filter(outcome => op.observedOutcomes.has(outcome));
      const pct = declared.length > 0 ? ((covered.length / declared.length) * 100).toFixed(1) : '100.0';
      lines.push(`  Operation: ${op.operationName}  (${covered.length}/${declared.length} outcomes, ${pct}%)`);
      for (const outcome of declared) {
        const count = op.observedOutcomes.get(outcome) ?? 0;
        lines.push(`    ${outcome.padEnd(12)} ${count > 0 ? `x${count}` : 'missing'}`);
      }
    }
  }
  lines.push('');

  // Gaps
  lines.push('--- Coverage Gaps ---');
  if (report.gaps.length === 0) {
    lines.push('  (no uncovered declared bins)');
  } else {
    for (const gap of report.gaps) {
      lines.push(`  ${gap.kind}:${gap.id} missing ${gap.missing.join(', ')}`);
    }
  }
  lines.push('');

  // Summary
  lines.push('--- Summary ---');
  lines.push(`  Total points:   ${report.summary.totalPoints}`);
  lines.push(`  Covered points: ${report.summary.coveredPoints}`);
  lines.push(`  Coverage:       ${report.summary.percentage.toFixed(1)}%`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Format a coverage report as JSON for CI consumption.
 */
export function formatJSON(report: CoverageReport): string {
  // Convert Maps to plain objects for JSON serialization
  const serializable = {
    toggle: report.toggle,
    transitions: report.transitions.map(t => ({
      fsmId: t.fsmId,
      transitions: Object.fromEntries(t.transitions),
      states: [...t.states],
      plannedTransitions: [...(t.plannedTransitions ?? [])],
    })),
    numericActivity: report.numericActivity ?? [],
    cross: report.cross.map(c => ({
      groupId: c.groupId,
      signals: c.signals,
      observed: Object.fromEntries(c.observed),
      total: c.total,
    })),
    operations: report.operations.map(o => ({
      operationName: o.operationName,
      declaredOutcomes: [...o.declaredOutcomes],
      observedOutcomes: Object.fromEntries(o.observedOutcomes),
    })),
    gaps: report.gaps,
    summary: report.summary,
  };
  return JSON.stringify(serializable, null, 2);
}

/**
 * Format a coverage report as an HTML page with colored matrices.
 */
export function formatHTML(report: CoverageReport): string {
  const lines: string[] = [];

  lines.push('<!DOCTYPE html>');
  lines.push('<html><head><meta charset="utf-8"><title>Veriscope Coverage</title>');
  lines.push('<style>');
  lines.push('body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2em auto; }');
  lines.push('h1 { color: #333; } h2 { color: #555; margin-top: 2em; }');
  lines.push('table { border-collapse: collapse; margin: 1em 0; }');
  lines.push('th, td { border: 1px solid #ddd; padding: 6px 12px; text-align: center; }');
  lines.push('th { background: #f5f5f5; }');
  lines.push('.covered { background: #c6efce; color: #006100; }');
  lines.push('.uncovered { background: #ffc7ce; color: #9c0006; }');
  lines.push('.summary { font-size: 1.2em; padding: 1em; border-radius: 8px; }');
  lines.push('.summary.pass { background: #c6efce; } .summary.fail { background: #ffc7ce; }');
  lines.push('</style></head><body>');

  lines.push('<h1>Veriscope Reactive Coverage Report</h1>');

  // Summary
  const summaryClass = report.summary.percentage >= 80 ? 'pass' : 'fail';
  lines.push(`<div class="summary ${summaryClass}">`);
  lines.push(`Coverage: <strong>${report.summary.percentage.toFixed(1)}%</strong> `);
  lines.push(`(${report.summary.coveredPoints}/${report.summary.totalPoints} points)`);
  lines.push('</div>');

  // Toggle
  lines.push('<h2>Toggle Coverage</h2>');
  if (report.toggle.length > 0) {
    lines.push('<table><tr><th>Signal</th><th>Seen True</th><th>Seen False</th></tr>');
    for (const t of report.toggle) {
      const trueClass = t.seenTrue ? 'covered' : 'uncovered';
      const falseClass = t.seenFalse ? 'covered' : 'uncovered';
      lines.push(`<tr><td>${esc(t.signalId)}</td><td class="${trueClass}">${t.seenTrue ? 'Yes' : 'No'}</td><td class="${falseClass}">${t.seenFalse ? 'Yes' : 'No'}</td></tr>`);
    }
    lines.push('</table>');
  } else {
    lines.push('<p>No toggle coverage points.</p>');
  }

  // Transitions
  lines.push('<h2>FSM Transition Coverage</h2>');
  if (report.transitions.length > 0) {
    for (const fsm of report.transitions) {
      const states = [...fsm.states];
      const planned = fsm.plannedTransitions ?? new Set<string>();
      lines.push(`<h3>${esc(fsm.fsmId)}</h3>`);
      lines.push('<table><tr><th>From \\ To</th>');
      for (const s of states) lines.push(`<th>${esc(s)}</th>`);
      lines.push('</tr>');
      for (const from of states) {
        lines.push(`<tr><th>${esc(from)}</th>`);
        for (const to of states) {
          if (from === to) {
            lines.push('<td>-</td>');
          } else {
            const key = `${from}->${to}`;
            const count = fsm.transitions.get(key);
            const isPlanned = planned.size === 0 || planned.has(key);
            const cls = count ? 'covered' : isPlanned ? 'uncovered' : '';
            lines.push(`<td class="${cls}">${count ?? (isPlanned ? 0 : '-')}</td>`);
          }
        }
        lines.push('</tr>');
      }
      lines.push('</table>');
    }
  } else {
    lines.push('<p>No FSM coverage points.</p>');
  }

  // Numeric activity
  lines.push('<h2>Numeric Activity</h2>');
  if ((report.numericActivity ?? []).length > 0) {
    lines.push('<table><tr><th>Signal</th><th>Samples</th><th>Range</th><th>Largest Step</th></tr>');
    for (const item of report.numericActivity ?? []) {
      lines.push(`<tr><td>${esc(item.signalId)}</td><td>${item.samples}</td><td>${item.min}..${item.max}</td><td>${item.largestStep}</td></tr>`);
    }
    lines.push('</table>');
  } else {
    lines.push('<p>No numeric counter/gauge activity.</p>');
  }

  // Cross
  lines.push('<h2>Cross Coverage</h2>');
  if (report.cross.length > 0) {
    for (const group of report.cross) {
      const pct = group.total > 0 ? ((group.observed.size / group.total) * 100).toFixed(1) : '0.0';
      lines.push(`<h3>${esc(group.groupId)} [${group.signals.map(esc).join(', ')}] — ${pct}%</h3>`);
      lines.push('<table><tr><th>Combination</th><th>Count</th></tr>');
      for (const [combo, count] of group.observed) {
        lines.push(`<tr><td class="covered">[${esc(combo)}]</td><td>${count}</td></tr>`);
      }
      // Show uncovered combos
      const n = group.signals.length;
      for (let i = 0; i < (1 << n); i++) {
        const key = group.signals.map((_, j) => (i & (1 << j)) ? '1' : '0').join(',');
        if (!group.observed.has(key)) {
          lines.push(`<tr><td class="uncovered">[${esc(key)}]</td><td>0</td></tr>`);
        }
      }
      lines.push('</table>');
    }
  } else {
    lines.push('<p>No cross coverage groups.</p>');
  }

  // Operations
  lines.push('<h2>Operation Outcome Coverage</h2>');
  if (report.operations.length > 0) {
    for (const op of report.operations) {
      lines.push(`<h3>${esc(op.operationName)}</h3>`);
      lines.push('<table><tr><th>Outcome</th><th>Observed</th></tr>');
      for (const outcome of op.declaredOutcomes) {
        const count = op.observedOutcomes.get(outcome) ?? 0;
        const cls = count > 0 ? 'covered' : 'uncovered';
        lines.push(`<tr><td>${esc(outcome)}</td><td class="${cls}">${count}</td></tr>`);
      }
      lines.push('</table>');
    }
  } else {
    lines.push('<p>No operation outcome coverage.</p>');
  }

  lines.push('<h2>Coverage Gaps</h2>');
  if (report.gaps.length > 0) {
    lines.push('<ul>');
    for (const gap of report.gaps) {
      lines.push(`<li>${esc(gap.kind)}:${esc(gap.id)} missing ${esc(gap.missing.join(', '))}</li>`);
    }
    lines.push('</ul>');
  } else {
    lines.push('<p>No uncovered declared bins.</p>');
  }

  lines.push('</body></html>');
  return lines.join('\n');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
