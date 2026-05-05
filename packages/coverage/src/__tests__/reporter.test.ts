import { describe, it, expect } from 'vitest';
import { CoverageCollector } from '@veriscope/graph';
import { formatConsole, formatJSON, formatHTML } from '../reporter';

function buildSampleReport() {
  const collector = new CoverageCollector();
  collector.enable();

  // Toggle
  collector.recordToggle('sig-a', true);
  collector.recordToggle('sig-a', false);
  collector.recordToggle('sig-b', true);
  // sig-b only seen true

  // Transitions
  collector.recordTransition('traffic', 'red', 'green');
  collector.recordTransition('traffic', 'green', 'yellow');
  collector.recordTransition('traffic', 'yellow', 'red');

  // Cross
  collector.registerCrossGroup('ab-cross', ['sig-a', 'sig-b']);
  collector.recordCross('ab-cross', [true, true]);
  collector.recordCross('ab-cross', [true, false]);
  collector.recordCross('ab-cross', [false, true]);

  collector.declareOperationOutcomes('submit', ['resolved', 'rejected']);
  collector.recordOperationOutcome('submit', 'resolved');

  return collector.getReport();
}

describe('formatConsole', () => {
  it('produces readable output with all sections', () => {
    const report = buildSampleReport();
    const output = formatConsole(report);

    expect(output).toContain('Toggle Coverage');
    expect(output).toContain('sig-a');
    expect(output).toContain('sig-b');
    expect(output).toContain('Transition');
    expect(output).toContain('traffic');
    expect(output).toContain('red->green');
    expect(output).toContain('Cross Coverage');
    expect(output).toContain('ab-cross');
    expect(output).toContain('Operation Outcome Coverage');
    expect(output).toContain('submit');
    expect(output).toContain('Coverage Gaps');
    expect(output).toContain('Summary');
  });

  it('handles empty report', () => {
    const collector = new CoverageCollector();
    const report = collector.getReport();
    const output = formatConsole(report);
    expect(output).toContain('no toggle coverage points');
    expect(output).toContain('0.0%');
  });
});

describe('formatJSON', () => {
  it('produces valid JSON', () => {
    const report = buildSampleReport();
    const json = formatJSON(report);
    const parsed = JSON.parse(json);

    expect(parsed.toggle).toHaveLength(2);
    expect(parsed.transitions).toHaveLength(1);
    expect(parsed.transitions[0].transitions['red->green']).toBe(1);
    expect(parsed.cross).toHaveLength(1);
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.gaps.length).toBeGreaterThan(0);
    expect(parsed.summary.totalPoints).toBeGreaterThan(0);
  });
});

describe('formatHTML', () => {
  it('produces valid HTML with coverage classes', () => {
    const report = buildSampleReport();
    const html = formatHTML(report);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Toggle Coverage');
    expect(html).toContain('Operation Outcome Coverage');
    expect(html).toContain('Coverage Gaps');
    expect(html).toContain('class="covered"');
    expect(html).toContain('class="uncovered"');
    expect(html).toContain('</html>');
  });
});
