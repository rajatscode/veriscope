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
      confidence: 'verified',
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
    expect(result.assertions[0].reason).toContain('assertion reads no graph signals');
    expect(result.assertions[0].confidence).toBe('unverifiable');
  });

  it('confidence is verified for fully-exercised assertions with deps', async () => {
    const g = new CircuitGraph();
    let aVal = false;
    const a = g.registerNode({ name: 'a', type: 'signal' });
    g.setNodeValue(a, () => aVal);
    g.setNodeSetter(a, (next: boolean) => { aVal = next; });

    const assertId = g.registerNode({
      name: 'always-true',
      type: 'assertion',
      deps: [a],
      assertionMetadata: { checkDeps: [a] },
    });
    g.setAssertionFn(assertId, () => true, 'always');

    const result = await runAutotest(g, { budget: 4 });

    expect(result.assertions[0].confidence).toBe('verified');
    expect(result.assertions[0].exercised).toBe(true);
    expect(result.assertions[0].partialCoverage).toBe(false);
    expect(result.confidence.verified).toBe(1);
    expect(result.confidence.partial).toBe(0);
    expect(result.confidence.unverifiable).toBe(0);
  });

  it('confidence is partial for assertions with partial coverage', async () => {
    const g = new CircuitGraph();
    let aVal = false;
    const a = g.registerNode({ name: 'a', type: 'signal' });
    g.setNodeValue(a, () => aVal);
    g.setNodeSetter(a, (next: boolean) => { aVal = next; });

    const assertId = g.registerNode({
      name: 'partial-check',
      type: 'assertion',
      assertionMetadata: { partial: true, checkDeps: [a] },
    });
    g.setAssertionFn(assertId, () => true, 'always');

    const result = await runAutotest(g, { budget: 4 });

    expect(result.assertions[0].confidence).toBe('partial');
    expect(result.assertions[0].partialCoverage).toBe(true);
    expect(result.confidence.partial).toBe(1);
  });

  it('provides specific reason when assertion has explorable roots but no deps', async () => {
    const g = new CircuitGraph();
    let aVal = false;
    const a = g.registerNode({ name: 'a', type: 'signal' });
    g.setNodeValue(a, () => aVal);
    g.setNodeSetter(a, (next: boolean) => { aVal = next; });

    // Register assertion without deps but with an edge to 'a' in the graph
    const assertId = g.registerNode({ name: 'no-deps', type: 'assertion' });
    g.setAssertionFn(assertId, () => true, 'always');
    g.addEdge(a, assertId);

    const result = await runAutotest(g, { budget: 4 });

    expect(result.assertions[0].partialCoverage).toBe(true);
    expect(result.assertions[0].reason).toMatch(/missing dependency metadata — explorer found \d+ reachable signal/);
    expect(result.assertions[0].confidence).toBe('partial');
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
