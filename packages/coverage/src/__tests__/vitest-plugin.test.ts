import { describe, it, expect, vi } from 'vitest';
import { veriscopeCoverageReporter } from '../vitest-plugin';
import type { CoverageReport } from '@veriscope/graph';

function makeReport(overrides: Partial<CoverageReport> = {}): CoverageReport {
  return {
    toggle: [
      { signalId: 'a', seenTrue: true, seenFalse: true },
      { signalId: 'b', seenTrue: true, seenFalse: false },
    ],
    transitions: [
      {
        fsmId: 'fsm1',
        transitions: new Map([['idle->active', 3]]),
        states: new Set(['idle', 'active']),
      },
    ],
    cross: [
      {
        groupId: 'g1',
        signals: ['a', 'b'],
        observed: new Map([['1,1', 2], ['0,1', 1]]),
        total: 4,
      },
    ],
    operations: [],
    gaps: [],
    summary: { totalPoints: 8, coveredPoints: 5, percentage: 62.5 },
    ...overrides,
  };
}

describe('veriscopeCoverageReporter', () => {
  it('outputs console format by default', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const reporter = veriscopeCoverageReporter({
      getReport: () => makeReport(),
    });

    reporter.onTestRunEnd([], [], 'passed');

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('Veriscope Reactive Coverage Report');
    expect(output).toContain('Toggle Coverage');
    consoleSpy.mockRestore();
  });

  it('outputs json format', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const reporter = veriscopeCoverageReporter({
      format: 'json',
      getReport: () => makeReport(),
    });

    reporter.onTestRunEnd();

    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.summary.percentage).toBe(62.5);
    consoleSpy.mockRestore();
  });

  it('checks thresholds and sets exitCode on failure', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const originalExitCode = process.exitCode;

    const reporter = veriscopeCoverageReporter({
      getReport: () => makeReport(),
      thresholds: { overall: 90 },
    });

    reporter.onTestRunEnd();

    expect(errorSpy).toHaveBeenCalled();
    const errorOutput = errorSpy.mock.calls.flat().join(' ');
    expect(errorOutput).toContain('thresholds not met');
    expect(process.exitCode).toBe(1);

    process.exitCode = originalExitCode;
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('passes when thresholds are met', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    const reporter = veriscopeCoverageReporter({
      getReport: () => makeReport(),
      thresholds: { overall: 50 },
    });

    reporter.onTestRunEnd();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();

    process.exitCode = originalExitCode;
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
