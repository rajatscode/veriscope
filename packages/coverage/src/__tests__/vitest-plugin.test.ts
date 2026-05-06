import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    numericActivity: [],
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

  it('runs as a real Vitest reporter in a child Vitest process', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
    const tmp = mkdtempSync(join('/private/tmp', 'veriscope-vitest-reporter-'));
    try {
      const configPath = join(tmp, 'vitest.config.mjs');
      const testPath = join(tmp, 'sample.test.ts');
      const reportPath = join(tmp, 'veriscope-coverage.json');

      writeFileSync(configPath, `
        import { veriscopeCoverageReporter } from '${resolve(repoRoot, 'packages/coverage/src/index.ts')}';

        export default {
          root: '${tmp}',
          resolve: {
            alias: {
              '@veriscope/graph': '${resolve(repoRoot, 'packages/graph/src/index.ts')}',
              '@veriscope/coverage': '${resolve(repoRoot, 'packages/coverage/src/index.ts')}',
            },
          },
          test: {
            include: ['sample.test.ts'],
            reporters: ['default', veriscopeCoverageReporter({
              inputFiles: ['${reportPath}'],
              thresholds: { overall: 100 },
            })],
          },
        };
      `);

      writeFileSync(testPath, `
        import { expect, it } from 'vitest';
        import { coverage } from '@veriscope/graph';
        import { saveCoverageToFile } from '@veriscope/coverage';

        it('records complete toggle coverage', () => {
          coverage.reset();
          coverage.enable();
          coverage.recordToggle('flag', true);
          coverage.recordToggle('flag', false);
          expect(coverage.getReport().summary.percentage).toBe(100);
          saveCoverageToFile(coverage.getReport(), '${reportPath}');
        });
      `);

      const vitestBin = resolve(repoRoot, 'node_modules/vitest/vitest.mjs');
      const result = spawnSync(process.execPath, [vitestBin, 'run', '--config', configPath], {
        cwd: repoRoot,
        encoding: 'utf-8',
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).toBe(0);
      expect(output).toContain('Veriscope Reactive Coverage Report');
      expect(output).toContain('100.0%');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 20_000);
});
