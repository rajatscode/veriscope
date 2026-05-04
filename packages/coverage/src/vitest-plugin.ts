// vitest-plugin.ts — Vitest custom reporter that outputs reactive coverage alongside standard coverage

import type { CoverageReport } from '@veriscope/graph';
import { coverage } from '@veriscope/graph';
import { formatConsole, formatJSON, formatHTML } from './reporter.js';
import { checkThresholds, type CoverageThresholds } from './thresholds.js';

export interface VeriscopeCoverageReporterOptions {
  /** Format: 'console' | 'json' | 'html'. Default: 'console'. */
  format?: 'console' | 'json' | 'html';
  /** Coverage thresholds — fail the run if not met. */
  thresholds?: CoverageThresholds;
  /** Output file path for json/html format. */
  outputFile?: string;
  /** If provided, called to get the CoverageReport (for testability). Otherwise uses global singleton. */
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

    onTestRunEnd(_testModules?: any[], _unhandledErrors?: any[], _reason?: string) {
      const report = options.getReport ? options.getReport() : coverage.getReport();

      // Format and output
      let output: string;
      if (format === 'json') {
        output = formatJSON(report);
      } else if (format === 'html') {
        output = formatHTML(report);
      } else {
        output = formatConsole(report);
      }

      if (options.outputFile) {
        // Write to file — dynamic import to keep browser-portability
        import('fs').then(fs => {
          fs.writeFileSync(options.outputFile!, output, 'utf-8');
        }).catch(() => {
          // Fallback: print to console if fs not available
          console.log('\n' + output);
        });
      } else {
        console.log('\n' + output);
      }

      // Check thresholds
      if (options.thresholds) {
        const result = checkThresholds(report, options.thresholds);
        if (!result.pass) {
          console.error('\nVeriscope coverage thresholds not met:');
          result.failures.forEach(f => console.error(`  - ${f}`));
          process.exitCode = 1;
        }
      }
    },
  };
}
