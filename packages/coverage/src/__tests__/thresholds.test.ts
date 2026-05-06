import { describe, it, expect } from 'vitest';
import { CoverageCollector } from '@veriscope/graph';
import { checkThresholds } from '../thresholds';

describe('checkThresholds', () => {
  it('passes when coverage exceeds thresholds', () => {
    const collector = new CoverageCollector();
    collector.enable();
    collector.recordToggle('a', true);
    collector.recordToggle('a', false);

    const report = collector.getReport();
    const result = checkThresholds(report, { toggle: 50, overall: 50 });
    expect(result.pass).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('fails when toggle coverage below threshold', () => {
    const collector = new CoverageCollector();
    collector.enable();
    collector.recordToggle('a', true);
    // never seen false -> 50% toggle

    const report = collector.getReport();
    const result = checkThresholds(report, { toggle: 80 });
    expect(result.pass).toBe(false);
    expect(result.failures[0]).toContain('Toggle coverage');
    expect(result.failures[0]).toContain('50.0%');
  });

  it('fails when transition coverage below threshold', () => {
    const collector = new CoverageCollector();
    collector.declarePlannedTransition('fsm', 'a', 'b');
    collector.declarePlannedTransition('fsm', 'b', 'c');
    collector.declarePlannedTransition('fsm', 'c', 'a');
    collector.enable();
    collector.recordTransition('fsm', 'a', 'b');
    collector.recordTransition('fsm', 'b', 'c');
    // 3 planned transitions, only 2 observed = 66.7%

    const report = collector.getReport();
    const result = checkThresholds(report, { transitions: 80 });
    expect(result.pass).toBe(false);
    expect(result.failures[0]).toContain('Transition coverage');
  });

  it('fails when cross coverage below threshold', () => {
    const collector = new CoverageCollector();
    collector.enable();
    collector.registerCrossGroup('g', ['a', 'b']);
    collector.recordCross('g', [true, true]);
    // 1/4 = 25%

    const report = collector.getReport();
    const result = checkThresholds(report, { cross: 50 });
    expect(result.pass).toBe(false);
    expect(result.failures[0]).toContain('Cross coverage');
  });

  it('passes with no thresholds specified', () => {
    const collector = new CoverageCollector();
    const report = collector.getReport();
    const result = checkThresholds(report, {});
    expect(result.pass).toBe(true);
  });

  it('passes when empty report and thresholds not set', () => {
    const collector = new CoverageCollector();
    const report = collector.getReport();
    // With no data, percentage defaults to 100% for unset thresholds
    const result = checkThresholds(report, { toggle: 0 });
    expect(result.pass).toBe(true);
  });
});
