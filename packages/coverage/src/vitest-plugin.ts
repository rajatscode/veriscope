// vitest-plugin.ts — Vitest custom reporter that outputs reactive coverage alongside standard coverage

import type { CoverageReport } from '@veriscope/graph';
import { formatConsole, formatJSON } from './reporter.js';

export interface VeriscopeCoverageReporterOptions {
  /** Format: 'console' | 'json'. Default: 'console'. */
  format?: 'console' | 'json';
  /** If provided, called to get the CoverageReport (for testability). */
  getReport?: () => CoverageReport;
}

/**
 * Creates a Vitest-compatible reporter object that outputs Veriscope reactive coverage
 * after the test run completes.
 *
 * Usage in vitest.config.ts:
 * ```ts
 * import { veriscopeCoverageReporter } from '@veriscope/coverage';
 * export default { reporters: ['default', veriscopeCoverageReporter()] };
 * ```
 */
export function veriscopeCoverageReporter(options: VeriscopeCoverageReporterOptions = {}) {
  const format = options.format ?? 'console';

  return {
    name: 'veriscope-coverage',

    onFinished(_files?: any[], _errors?: any[]) {
      if (!options.getReport) {
        // In real use, this would import the global coverage singleton
        // For now, this is a hook point — users wire it up via getReport
        return;
      }

      const report = options.getReport();

      if (format === 'console') {
        const output = formatConsole(report);
        console.log('\n' + output);
      } else {
        console.log(formatJSON(report));
      }
    },
  };
}
