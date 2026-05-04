// merge.ts — Merge coverage reports across test runs

import type { CoverageReport, ToggleCoverage, TransitionCoverage, CrossCoverage } from '@veriscope/graph';

/**
 * Merge multiple coverage reports into a single aggregate report.
 * - Toggle: union of seen states (OR seenTrue/seenFalse)
 * - Transitions: union of transition keys, sum counts
 * - Cross: union of observed combos, sum counts
 * - Summary: recalculated from merged data
 */
export function mergeCoverageReports(...reports: CoverageReport[]): CoverageReport {
  const toggleMap = new Map<string, ToggleCoverage>();
  const transitionMap = new Map<string, TransitionCoverage>();
  const crossMap = new Map<string, CrossCoverage>();

  for (const report of reports) {
    // Merge toggle coverage
    for (const t of report.toggle) {
      const existing = toggleMap.get(t.signalId);
      if (existing) {
        existing.seenTrue = existing.seenTrue || t.seenTrue;
        existing.seenFalse = existing.seenFalse || t.seenFalse;
      } else {
        toggleMap.set(t.signalId, { ...t });
      }
    }

    // Merge transition coverage
    for (const fsm of report.transitions) {
      const existing = transitionMap.get(fsm.fsmId);
      if (existing) {
        for (const state of fsm.states) {
          existing.states.add(state);
        }
        for (const [key, count] of fsm.transitions) {
          existing.transitions.set(key, (existing.transitions.get(key) ?? 0) + count);
        }
      } else {
        transitionMap.set(fsm.fsmId, {
          fsmId: fsm.fsmId,
          transitions: new Map(fsm.transitions),
          states: new Set(fsm.states),
        });
      }
    }

    // Merge cross coverage
    for (const group of report.cross) {
      const existing = crossMap.get(group.groupId);
      if (existing) {
        for (const [combo, count] of group.observed) {
          existing.observed.set(combo, (existing.observed.get(combo) ?? 0) + count);
        }
        // Take max total (should be same if same group, but be safe)
        existing.total = Math.max(existing.total, group.total);
      } else {
        crossMap.set(group.groupId, {
          groupId: group.groupId,
          signals: [...group.signals],
          observed: new Map(group.observed),
          total: group.total,
        });
      }
    }
  }

  // Recalculate summary
  const toggle = [...toggleMap.values()];
  const transitions = [...transitionMap.values()];
  const cross = [...crossMap.values()];

  let totalPoints = 0;
  let coveredPoints = 0;

  for (const t of toggle) {
    totalPoints += 2;
    if (t.seenTrue) coveredPoints++;
    if (t.seenFalse) coveredPoints++;
  }

  for (const c of cross) {
    totalPoints += c.total;
    coveredPoints += c.observed.size;
  }

  const percentage = totalPoints > 0 ? (coveredPoints / totalPoints) * 100 : 0;

  return {
    toggle,
    transitions,
    cross,
    summary: { totalPoints, coveredPoints, percentage },
  };
}

/**
 * Serialize a coverage report to JSON and write to disk.
 */
export function saveCoverageToFile(report: CoverageReport, path: string): void {
  // Convert Maps to serializable form
  const serializable = {
    toggle: report.toggle,
    transitions: report.transitions.map(t => ({
      fsmId: t.fsmId,
      transitions: Object.fromEntries(t.transitions),
      states: [...t.states],
    })),
    cross: report.cross.map(c => ({
      groupId: c.groupId,
      signals: c.signals,
      observed: Object.fromEntries(c.observed),
      total: c.total,
    })),
    summary: report.summary,
  };

  // Use require to keep this synchronous and avoid top-level import
  const fs = require('fs');
  fs.writeFileSync(path, JSON.stringify(serializable, null, 2), 'utf-8');
}

/**
 * Load a coverage report from a JSON file on disk.
 */
export function loadCoverageFromFile(path: string): CoverageReport {
  const fs = require('fs');
  const raw = JSON.parse(fs.readFileSync(path, 'utf-8'));

  return {
    toggle: raw.toggle,
    transitions: raw.transitions.map((t: any) => ({
      fsmId: t.fsmId,
      transitions: new Map(Object.entries(t.transitions).map(([k, v]) => [k, v as number])),
      states: new Set(t.states as string[]),
    })),
    cross: raw.cross.map((c: any) => ({
      groupId: c.groupId,
      signals: c.signals,
      observed: new Map(Object.entries(c.observed).map(([k, v]) => [k, v as number])),
      total: c.total,
    })),
    summary: raw.summary,
  };
}
