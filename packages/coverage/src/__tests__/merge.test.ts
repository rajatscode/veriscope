import { describe, it, expect } from 'vitest';
import { mergeCoverageReports } from '../merge';
import type { CoverageReport } from '@veriscope/graph';

function makeReport(overrides: Partial<CoverageReport> = {}): CoverageReport {
  return {
    toggle: [],
    transitions: [],
    cross: [],
    operations: [],
    gaps: [],
    summary: { totalPoints: 0, coveredPoints: 0, percentage: 0 },
    ...overrides,
  };
}

describe('mergeCoverageReports', () => {
  it('merges toggle coverage (union of seen states)', () => {
    const r1 = makeReport({
      toggle: [
        { signalId: 'a', seenTrue: true, seenFalse: false },
        { signalId: 'b', seenTrue: false, seenFalse: true },
      ],
    });
    const r2 = makeReport({
      toggle: [
        { signalId: 'a', seenTrue: false, seenFalse: true },
        { signalId: 'c', seenTrue: true, seenFalse: true },
      ],
    });

    const merged = mergeCoverageReports(r1, r2);

    const aToggle = merged.toggle.find(t => t.signalId === 'a')!;
    expect(aToggle.seenTrue).toBe(true);
    expect(aToggle.seenFalse).toBe(true);

    const bToggle = merged.toggle.find(t => t.signalId === 'b')!;
    expect(bToggle.seenTrue).toBe(false);
    expect(bToggle.seenFalse).toBe(true);

    const cToggle = merged.toggle.find(t => t.signalId === 'c')!;
    expect(cToggle.seenTrue).toBe(true);
    expect(cToggle.seenFalse).toBe(true);
  });

  it('merges transition coverage (union keys, sum counts)', () => {
    const r1 = makeReport({
      transitions: [{
        fsmId: 'fsm1',
        transitions: new Map([['idle->active', 2]]),
        states: new Set(['idle', 'active']),
      }],
    });
    const r2 = makeReport({
      transitions: [{
        fsmId: 'fsm1',
        transitions: new Map([['idle->active', 3], ['active->idle', 1]]),
        states: new Set(['idle', 'active']),
      }],
    });

    const merged = mergeCoverageReports(r1, r2);

    expect(merged.transitions).toHaveLength(1);
    const fsm = merged.transitions[0];
    expect(fsm.transitions.get('idle->active')).toBe(5);
    expect(fsm.transitions.get('active->idle')).toBe(1);
    expect(fsm.states.size).toBe(2);
  });

  it('merges cross coverage (union combos, sum counts)', () => {
    const r1 = makeReport({
      cross: [{
        groupId: 'g1',
        signals: ['a', 'b'],
        observed: new Map([['1,1', 2]]),
        total: 4,
      }],
    });
    const r2 = makeReport({
      cross: [{
        groupId: 'g1',
        signals: ['a', 'b'],
        observed: new Map([['1,1', 1], ['0,1', 3]]),
        total: 4,
      }],
    });

    const merged = mergeCoverageReports(r1, r2);

    expect(merged.cross).toHaveLength(1);
    const group = merged.cross[0];
    expect(group.observed.get('1,1')).toBe(3);
    expect(group.observed.get('0,1')).toBe(3);
    expect(group.total).toBe(4);
  });

  it('merges non-overlapping reports', () => {
    const r1 = makeReport({
      toggle: [{ signalId: 'a', seenTrue: true, seenFalse: false }],
      transitions: [{
        fsmId: 'fsm1',
        transitions: new Map([['idle->active', 1]]),
        states: new Set(['idle', 'active']),
      }],
    });
    const r2 = makeReport({
      toggle: [{ signalId: 'b', seenTrue: false, seenFalse: true }],
      transitions: [{
        fsmId: 'fsm2',
        transitions: new Map([['on->off', 2]]),
        states: new Set(['on', 'off']),
      }],
    });

    const merged = mergeCoverageReports(r1, r2);

    expect(merged.toggle).toHaveLength(2);
    expect(merged.transitions).toHaveLength(2);
  });

  it('recalculates summary correctly', () => {
    const r1 = makeReport({
      toggle: [
        { signalId: 'a', seenTrue: true, seenFalse: false }, // 1/2
      ],
    });
    const r2 = makeReport({
      toggle: [
        { signalId: 'a', seenTrue: false, seenFalse: true }, // merges to 2/2
      ],
    });

    const merged = mergeCoverageReports(r1, r2);

    expect(merged.summary.totalPoints).toBe(2);
    expect(merged.summary.coveredPoints).toBe(2);
    expect(merged.summary.percentage).toBe(100);
  });

  it('handles empty reports', () => {
    const merged = mergeCoverageReports(makeReport(), makeReport());
    expect(merged.toggle).toHaveLength(0);
    expect(merged.transitions).toHaveLength(0);
    expect(merged.cross).toHaveLength(0);
    expect(merged.summary.percentage).toBe(0);
  });

  it('merges three reports', () => {
    const r1 = makeReport({ toggle: [{ signalId: 'a', seenTrue: true, seenFalse: false }] });
    const r2 = makeReport({ toggle: [{ signalId: 'a', seenTrue: false, seenFalse: false }] });
    const r3 = makeReport({ toggle: [{ signalId: 'a', seenTrue: false, seenFalse: true }] });

    const merged = mergeCoverageReports(r1, r2, r3);
    const a = merged.toggle.find(t => t.signalId === 'a')!;
    expect(a.seenTrue).toBe(true);
    expect(a.seenFalse).toBe(true);
  });
});
