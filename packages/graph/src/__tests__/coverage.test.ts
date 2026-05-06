import { describe, it, expect } from 'vitest';
import { CoverageCollector } from '../coverage';

describe('CoverageCollector', () => {
  it('records toggle coverage', () => {
    const c = new CoverageCollector();
    c.enable();
    c.recordToggle('sig1', true);
    c.recordToggle('sig1', false);
    const report = c.getReport();
    expect(report.toggle[0].seenTrue).toBe(true);
    expect(report.toggle[0].seenFalse).toBe(true);
  });

  it('records FSM transitions', () => {
    const c = new CoverageCollector();
    c.enable();
    c.recordTransition('fsm1', 'idle', 'loading');
    c.recordTransition('fsm1', 'loading', 'success');
    const report = c.getReport();
    expect(report.transitions[0].transitions.size).toBe(2);
  });

  it('treats observed transitions as observed activity without inferred all-pairs gaps', () => {
    const c = new CoverageCollector();
    c.enable();
    c.recordTransition('fsm1', 'idle', 'loading');
    c.recordTransition('fsm1', 'loading', 'success');

    const report = c.getReport();

    expect(report.summary.totalPoints).toBe(2);
    expect(report.summary.coveredPoints).toBe(2);
    expect(report.gaps.some(gap => gap.kind === 'transition')).toBe(false);
  });

  it('reports missing planned transition gaps only from generated plans', () => {
    const c = new CoverageCollector();
    c.declarePlannedTransition('fsm1', 'idle', 'loading');
    c.declarePlannedTransition('fsm1', 'loading', 'success');
    c.enable();
    c.recordTransition('fsm1', 'idle', 'loading');

    const report = c.getReport();

    expect(report.summary.totalPoints).toBe(2);
    expect(report.summary.coveredPoints).toBe(1);
    expect(report.gaps).toContainEqual({
      kind: 'transition',
      id: 'fsm1',
      missing: ['loading->success'],
    });
  });

  it('does nothing when disabled', () => {
    const c = new CoverageCollector();
    c.recordToggle('sig1', true);
    expect(c.getReport().toggle).toHaveLength(0);
  });

  it('records cross coverage', () => {
    const c = new CoverageCollector();
    c.enable();
    c.registerCrossGroup('g1', ['a', 'b']);
    c.recordCross('g1', [true, false]);
    c.recordCross('g1', [false, true]);
    const report = c.getReport();
    expect(report.cross[0].observed.size).toBe(2);
    expect(report.cross[0].total).toBe(4);
  });

  it('computes summary correctly', () => {
    const c = new CoverageCollector();
    c.enable();
    c.recordToggle('s1', true);
    c.recordToggle('s1', false);
    c.recordToggle('s2', true);
    // s1 fully covered (2/2), s2 half covered (1/2) => 3/4 = 75%
    const report = c.getReport();
    expect(report.summary.totalPoints).toBe(4);
    expect(report.summary.coveredPoints).toBe(3);
    expect(report.summary.percentage).toBe(75);
  });

  it('reports explicit gaps for operation outcome domains', () => {
    const c = new CoverageCollector();
    c.declareOperationOutcomes('submit', ['resolved', 'rejected', 'timeout']);
    c.enable();
    c.recordOperationOutcome('submit', 'resolved');

    const report = c.getReport();

    expect(report.operations[0].operationName).toBe('submit');
    expect(report.summary.totalPoints).toBe(3);
    expect(report.summary.coveredPoints).toBe(1);
    expect(report.gaps).toContainEqual({
      kind: 'operation',
      id: 'submit',
      missing: ['rejected', 'timeout'],
    });
  });

  it('resets all data', () => {
    const c = new CoverageCollector();
    c.enable();
    c.recordToggle('sig1', true);
    c.reset();
    expect(c.getReport().toggle).toHaveLength(0);
  });

  it('tracks previous values', () => {
    const c = new CoverageCollector();
    c.setPreviousValue('x', 42);
    expect(c.getPreviousValue('x')).toBe(42);
  });
});
