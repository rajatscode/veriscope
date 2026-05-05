import { describe, expect, it } from 'vitest';
import { CircuitGraph } from '@veriscope/graph';
import { runAutotest } from '../autotest';

describe('runAutotest', () => {
  it('returns generated scenarios, assertion results, coverage gaps, and snapshot context', async () => {
    const g = new CircuitGraph();
    let aVal = false;
    let bVal = false;
    const a = g.registerNode({ name: 'a', type: 'signal' });
    const b = g.registerNode({ name: 'b', type: 'signal' });
    g.setNodeValue(a, () => aVal);
    g.setNodeSetter(a, (next: boolean) => { aVal = next; });
    g.setNodeValue(b, () => bVal);
    g.setNodeSetter(b, (next: boolean) => { bVal = next; });

    const assertId = g.registerNode({
      name: 'mutex',
      type: 'assertion',
      deps: [a, b],
      assertionMetadata: { checkDeps: [a, b] },
    });
    g.setAssertionFn(assertId, () => !(aVal && bVal), 'always');

    const result = await runAutotest(g, { budget: 4, name: 'mutex-test' });

    expect(result.status).toBe('failed');
    expect(result.violations.some(v => v.assertionName === 'mutex')).toBe(true);
    expect(result.scenarios.length).toBeGreaterThan(0);
    expect(result.assertions[0]).toMatchObject({
      name: 'mutex',
      status: 'failed',
      partialCoverage: false,
    });
    expect(result.coverage.overall.total).toBeGreaterThan(0);
    expect(result.snapshot?.captureContext?.tool).toBe('@veriscope/test/autotest');
    expect(result.snapshot?.captureContext?.name).toBe('mutex-test');
  });

  it('labels assertions without explorable metadata as partial coverage', async () => {
    const g = new CircuitGraph();
    const assertId = g.registerNode({ name: 'opaque', type: 'assertion' });
    g.setAssertionFn(assertId, () => true, 'always');

    const result = await runAutotest(g, { budget: 2 });

    expect(result.status).toBe('passed');
    expect(result.assertions[0].partialCoverage).toBe(true);
    expect(result.assertions[0].reason).toContain('missing explorable');
  });
});
