// merge.ts — Merge coverage reports across test runs

import type {
  CoverageGap,
  CoverageReport,
  CrossCoverage,
  NumericActivityCoverage,
  OperationOutcomeCoverage,
  ToggleCoverage,
  TransitionCoverage,
} from '@veriscope/graph';
import { readFileSync, writeFileSync } from 'node:fs';

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
  const numericActivityMap = new Map<string, NumericActivityCoverage>();
  const crossMap = new Map<string, CrossCoverage>();
  const operationMap = new Map<string, OperationOutcomeCoverage>();

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
        for (const planned of fsm.plannedTransitions ?? []) {
          if (!existing.plannedTransitions) existing.plannedTransitions = new Set();
          existing.plannedTransitions.add(planned);
        }
      } else {
        transitionMap.set(fsm.fsmId, {
          fsmId: fsm.fsmId,
          transitions: new Map(fsm.transitions),
          states: new Set(fsm.states),
          plannedTransitions: new Set(fsm.plannedTransitions ?? []),
        });
      }
    }

    // Merge numeric activity
    for (const item of report.numericActivity ?? []) {
      const existing = numericActivityMap.get(item.signalId);
      if (existing) {
        existing.samples += item.samples;
        existing.min = Math.min(existing.min, item.min);
        existing.max = Math.max(existing.max, item.max);
        existing.increments += item.increments;
        existing.decrements += item.decrements;
        existing.largestStep = Math.max(existing.largestStep, item.largestStep);
        existing.lastValue = item.lastValue;
      } else {
        numericActivityMap.set(item.signalId, { ...item });
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

    // Merge operation outcome coverage
    for (const op of report.operations ?? []) {
      const existing = operationMap.get(op.operationName);
      if (existing) {
        for (const outcome of op.declaredOutcomes) {
          existing.declaredOutcomes.add(outcome);
        }
        for (const [outcome, count] of op.observedOutcomes) {
          existing.observedOutcomes.set(outcome, (existing.observedOutcomes.get(outcome) ?? 0) + count);
        }
      } else {
        operationMap.set(op.operationName, {
          operationName: op.operationName,
          declaredOutcomes: new Set(op.declaredOutcomes),
          observedOutcomes: new Map(op.observedOutcomes),
        });
      }
    }
  }

  // Recalculate summary
  const toggle = [...toggleMap.values()];
  const transitions = [...transitionMap.values()];
  const numericActivity = [...numericActivityMap.values()];
  const cross = [...crossMap.values()];
  const operations = [...operationMap.values()];
  const gaps: CoverageGap[] = [];

  let totalPoints = 0;
  let coveredPoints = 0;

  for (const t of toggle) {
    totalPoints += 2;
    if (t.seenTrue) coveredPoints++;
    if (t.seenFalse) coveredPoints++;
    const missing: string[] = [];
    if (!t.seenTrue) missing.push('true');
    if (!t.seenFalse) missing.push('false');
    if (missing.length > 0) gaps.push({ kind: 'toggle', id: t.signalId, missing });
  }

  for (const fsm of transitions) {
    const planned = [...(fsm.plannedTransitions ?? [])];
    const total = planned.length > 0 ? planned.length : fsm.transitions.size;
    totalPoints += total;
    coveredPoints += planned.length > 0
      ? planned.filter(key => fsm.transitions.has(key)).length
      : fsm.transitions.size;
    const missing = planned.filter(key => !fsm.transitions.has(key));
    if (missing.length > 0) gaps.push({ kind: 'transition', id: fsm.fsmId, missing });
  }

  for (const c of cross) {
    totalPoints += c.total;
    coveredPoints += c.observed.size;
    const missing: string[] = [];
    const n = c.signals.length;
    for (let i = 0; i < c.total && missing.length < 128; i++) {
      const key = Array.from({ length: n }, (_, bit) => (i >> (n - 1 - bit)) & 1 ? '1' : '0').join(',');
      if (!c.observed.has(key)) missing.push(key);
    }
    if (missing.length > 0) gaps.push({ kind: 'cross', id: c.groupId, missing });
  }

  for (const op of operations) {
    totalPoints += op.declaredOutcomes.size;
    coveredPoints += [...op.declaredOutcomes].filter(outcome => op.observedOutcomes.has(outcome)).length;
    const missing = [...op.declaredOutcomes].filter(outcome => !op.observedOutcomes.has(outcome));
    if (missing.length > 0) gaps.push({ kind: 'operation', id: op.operationName, missing });
  }

  const percentage = totalPoints > 0 ? (coveredPoints / totalPoints) * 100 : 0;

  return {
    toggle,
    transitions,
    numericActivity,
    cross,
    operations,
    gaps,
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

  writeFileSync(path, JSON.stringify(serializable, null, 2), 'utf-8');
}

/**
 * Load a coverage report from a JSON file on disk.
 */
export function loadCoverageFromFile(path: string): CoverageReport {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));

  return {
    toggle: raw.toggle,
    transitions: raw.transitions.map((t: any) => ({
      fsmId: t.fsmId,
      transitions: new Map(Object.entries(t.transitions).map(([k, v]) => [k, v as number])),
      states: new Set(t.states as string[]),
      plannedTransitions: new Set((t.plannedTransitions ?? []) as string[]),
    })),
    numericActivity: raw.numericActivity ?? [],
    cross: raw.cross.map((c: any) => ({
      groupId: c.groupId,
      signals: c.signals,
      observed: new Map(Object.entries(c.observed).map(([k, v]) => [k, v as number])),
      total: c.total,
    })),
    operations: (raw.operations ?? []).map((o: any) => ({
      operationName: o.operationName,
      declaredOutcomes: new Set(o.declaredOutcomes as string[]),
      observedOutcomes: new Map(Object.entries(o.observedOutcomes ?? {}).map(([k, v]) => [k, v as number])),
    })),
    gaps: raw.gaps ?? [],
    summary: raw.summary,
  };
}
