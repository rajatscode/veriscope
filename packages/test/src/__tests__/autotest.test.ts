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
      exercised: true,
    });
    expect(result.assertions[0].scenarioCount).toBeGreaterThan(0);
    expect(result.assertions[0].passScenarioCount + result.assertions[0].failScenarioCount).toBe(result.assertions[0].scenarioCount);
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

  it('counts assertions checked by shared generated scenarios when the budget is exhausted early', async () => {
    const g = new CircuitGraph();
    let aVal = false;
    let bVal = false;
    let lateVal = false;
    const a = g.registerNode({ name: 'a', type: 'signal' });
    const b = g.registerNode({ name: 'b', type: 'signal' });
    const late = g.registerNode({ name: 'late', type: 'signal' });
    g.setNodeValue(a, () => aVal);
    g.setNodeSetter(a, (next: boolean) => { aVal = next; });
    g.setNodeValue(b, () => bVal);
    g.setNodeSetter(b, (next: boolean) => { bVal = next; });
    g.setNodeValue(late, () => lateVal);
    g.setNodeSetter(late, (next: boolean) => { lateVal = next; });

    const wide = g.registerNode({ name: 'wide-cone', type: 'assertion', deps: [a, b] });
    g.setAssertionFn(wide, () => true, 'always');
    const lateAssert = g.registerNode({ name: 'late-cone', type: 'assertion', deps: [late] });
    g.setAssertionFn(lateAssert, () => true, 'always');

    const result = await runAutotest(g, { budget: 2 });

    expect(result.scenarios).toHaveLength(2);
    expect(result.scenarios.every(scenario => scenario.assertions.includes('wide-cone'))).toBe(true);
    expect(result.scenarios.every(scenario => scenario.assertions.includes('late-cone'))).toBe(true);
    expect(result.assertions).toMatchObject([
      { name: 'wide-cone', exercised: true, scenarioCount: 2 },
      { name: 'late-cone', exercised: true, scenarioCount: 2 },
    ]);
  });
});
