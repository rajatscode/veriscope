// coverage.ts — HDL-style coverage collection for reactive state testing
// Extracted from Comb's runtime. Tracks toggle, FSM transition, and cross coverage.

export interface ToggleCoverage {
  signalId: string;
  seenTrue: boolean;
  seenFalse: boolean;
}

export interface TransitionCoverage {
  fsmId: string;
  transitions: Map<string, number>; // "stateA->stateB" -> count
  states: Set<string>;
}

export interface CrossCoverage {
  groupId: string;
  signals: string[];
  observed: Map<string, number>; // "1,0,1" -> count
  total: number; // 2^n possible combos for n boolean signals
}

export interface CoverageReport {
  toggle: ToggleCoverage[];
  transitions: TransitionCoverage[];
  cross: CrossCoverage[];
  summary: { totalPoints: number; coveredPoints: number; percentage: number };
}

/**
 * CoverageCollector instruments reactive primitives to measure test completeness.
 *
 * Three coverage types, inspired by hardware verification:
 * - Toggle: has every boolean signal been both true and false?
 * - Transition: which FSM state transitions have been exercised?
 * - Cross: which combinations of boolean signal values have been observed?
 */
export class CoverageCollector {
  private enabled = false;
  private toggleMap = new Map<string, ToggleCoverage>();
  private transitionMap = new Map<string, TransitionCoverage>();
  private crossGroups = new Map<string, CrossCoverage>();
  private previousValues = new Map<string, any>();

  /** Start collecting coverage data. */
  enable(): void {
    this.enabled = true;
  }

  /** Stop collecting coverage data (existing data is preserved). */
  disable(): void {
    this.enabled = false;
  }

  /** Returns true if coverage collection is active. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Record a boolean signal value for toggle coverage.
   * Called by the runtime on every boolean signal change.
   */
  recordToggle(signalId: string, value: boolean): void {
    if (!this.enabled) return;
    let entry = this.toggleMap.get(signalId);
    if (!entry) {
      entry = { signalId, seenTrue: false, seenFalse: false };
      this.toggleMap.set(signalId, entry);
    }
    if (value) entry.seenTrue = true;
    else entry.seenFalse = true;
  }

  /**
   * Record an FSM state transition.
   * Called on enum/string signal changes that represent state machines.
   */
  recordTransition(fsmId: string, from: string, to: string): void {
    if (!this.enabled) return;
    let entry = this.transitionMap.get(fsmId);
    if (!entry) {
      entry = { fsmId, transitions: new Map(), states: new Set() };
      this.transitionMap.set(fsmId, entry);
    }
    entry.states.add(from);
    entry.states.add(to);
    const key = `${from}->${to}`;
    entry.transitions.set(key, (entry.transitions.get(key) ?? 0) + 1);
  }

  /**
   * Register a cross-coverage group before recording observations.
   */
  registerCrossGroup(groupId: string, signalIds: string[]): void {
    this.crossGroups.set(groupId, {
      groupId,
      signals: signalIds,
      observed: new Map(),
      total: Math.pow(2, signalIds.length),
    });
  }

  /**
   * Record a cross-coverage observation for a previously registered group.
   */
  recordCross(groupId: string, values: boolean[]): void {
    if (!this.enabled) return;
    const group = this.crossGroups.get(groupId);
    if (!group) return;
    const key = values.map(v => v ? '1' : '0').join(',');
    group.observed.set(key, (group.observed.get(key) ?? 0) + 1);
  }

  /** Get the previous value of a signal (for transition detection). */
  getPreviousValue(signalId: string): any {
    return this.previousValues.get(signalId);
  }

  /** Store the current value of a signal for future transition detection. */
  setPreviousValue(signalId: string, value: any): void {
    this.previousValues.set(signalId, value);
  }

  /**
   * Generate a coverage report summarizing all collected data.
   */
  getReport(): CoverageReport {
    const toggle = [...this.toggleMap.values()];
    const transitions = [...this.transitionMap.values()];
    const cross = [...this.crossGroups.values()];

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

  /** Clear all collected coverage data. */
  reset(): void {
    this.toggleMap.clear();
    this.transitionMap.clear();
    this.crossGroups.clear();
    this.previousValues.clear();
  }
}

/** Global singleton — shared across the runtime. */
export const coverage = new CoverageCollector();
