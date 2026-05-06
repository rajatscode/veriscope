// thresholds.ts — Pass/fail thresholds for CI

import type { CoverageReport } from '@veriscope/graph';

export interface CoverageThresholds {
  /** Minimum toggle coverage percentage (0-100). */
  toggle?: number;
  /** Minimum transition coverage percentage (0-100). */
  transitions?: number;
  /** Minimum cross coverage percentage (0-100). */
  cross?: number;
  /** Minimum overall coverage percentage (0-100). */
  overall?: number;
}

export interface ThresholdResult {
  pass: boolean;
  failures: string[];
}

/**
 * Check coverage report against thresholds. Returns pass/fail with detailed failure messages.
 */
export function checkThresholds(report: CoverageReport, thresholds: CoverageThresholds): ThresholdResult {
  const failures: string[] = [];

  // Toggle coverage: each signal contributes 2 points (seenTrue + seenFalse)
  if (thresholds.toggle !== undefined) {
    const total = report.toggle.length * 2;
    let covered = 0;
    for (const t of report.toggle) {
      if (t.seenTrue) covered++;
      if (t.seenFalse) covered++;
    }
    const pct = total > 0 ? (covered / total) * 100 : 100;
    if (pct < thresholds.toggle) {
      failures.push(`Toggle coverage ${pct.toFixed(1)}% < threshold ${thresholds.toggle}%`);
    }
  }

  // Transition coverage: observed planned transitions / planned transitions.
  // Without a generated plan, observed finite-state runtime transitions are
  // complete by definition and do not create speculative missing bins.
  if (thresholds.transitions !== undefined) {
    let totalPlanned = 0;
    let totalCovered = 0;
    for (const fsm of report.transitions) {
      const planned = fsm.plannedTransitions ?? new Set<string>();
      if (planned.size > 0) {
        totalPlanned += planned.size;
        totalCovered += [...planned].filter(key => fsm.transitions.has(key)).length;
      } else {
        totalPlanned += fsm.transitions.size;
        totalCovered += fsm.transitions.size;
      }
    }
    const pct = totalPlanned > 0 ? (totalCovered / totalPlanned) * 100 : 100;
    if (pct < thresholds.transitions) {
      failures.push(`Transition coverage ${pct.toFixed(1)}% < threshold ${thresholds.transitions}%`);
    }
  }

  // Cross coverage: observed combos / total possible combos per group
  if (thresholds.cross !== undefined) {
    let totalPossible = 0;
    let totalObserved = 0;
    for (const group of report.cross) {
      totalPossible += group.total;
      totalObserved += group.observed.size;
    }
    const pct = totalPossible > 0 ? (totalObserved / totalPossible) * 100 : 100;
    if (pct < thresholds.cross) {
      failures.push(`Cross coverage ${pct.toFixed(1)}% < threshold ${thresholds.cross}%`);
    }
  }

  // Overall: use the report's built-in summary
  if (thresholds.overall !== undefined) {
    if (report.summary.percentage < thresholds.overall) {
      failures.push(`Overall coverage ${report.summary.percentage.toFixed(1)}% < threshold ${thresholds.overall}%`);
    }
  }

  return { pass: failures.length === 0, failures };
}
