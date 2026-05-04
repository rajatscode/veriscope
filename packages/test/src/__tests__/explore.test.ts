import { describe, it, expect } from 'vitest';
import { CircuitGraph } from '@veriscope/graph';
import { explore } from '../explore';
import { backwardCone } from '../backward-solve';
import { enumerateBooleanCombinations } from '../truth-table';
import { traceReads } from '../read-tracer';
import { parseComputeFn } from '../fn-parser';
import { shrinkSequence } from '../shrink';

describe('backwardCone', () => {
  it('finds root signals', () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    const b = g.registerNode({ name: 'b', type: 'signal' });
    const c = g.registerNode({ name: 'c', type: 'derived' });
    g.addEdge(a, c);
    g.addEdge(b, c);

    const roots = backwardCone(g, c);
    expect(roots).toContain(a);
    expect(roots).toContain(b);
    expect(roots).not.toContain(c);
  });

  it('traces through intermediate nodes', () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    const b = g.registerNode({ name: 'b', type: 'derived' });
    const c = g.registerNode({ name: 'c', type: 'derived' });
    g.addEdge(a, b);
    g.addEdge(b, c);

    const roots = backwardCone(g, c);
    expect(roots).toEqual([a]);
  });

  it('handles diamond dependencies', () => {
    const g = new CircuitGraph();
    const root = g.registerNode({ name: 'root', type: 'signal' });
    const left = g.registerNode({ name: 'left', type: 'derived' });
    const right = g.registerNode({ name: 'right', type: 'derived' });
    const merge = g.registerNode({ name: 'merge', type: 'derived' });
    g.addEdge(root, left);
    g.addEdge(root, right);
    g.addEdge(left, merge);
    g.addEdge(right, merge);

    const roots = backwardCone(g, merge);
    expect(roots).toEqual([root]);
  });
});

describe('enumerateBooleanCombinations', () => {
  it('generates 2^n rows for n signals', () => {
    let aVal = false, bVal = false;
    const signals = [
      { nodeId: 'a', set: (v: boolean) => { aVal = v; } },
      { nodeId: 'b', set: (v: boolean) => { bVal = v; } },
    ];
    const rows = enumerateBooleanCombinations(
      signals,
      () => aVal && bVal,
      () => {},
    );
    expect(rows).toHaveLength(4);
    // Only (true, true) should produce true output
    const trueRows = rows.filter(r => r.output === true);
    expect(trueRows).toHaveLength(1);
    expect(trueRows[0].inputs).toEqual([true, true]);
  });
});

describe('traceReads', () => {
  it('tracks .val reads', () => {
    const sigA = { val: 42 };
    const sigB = { val: 'hello' };
    const signals = new Map<string, { val: any }>([
      ['a', sigA],
      ['b', sigB],
    ]);

    const { result, reads } = traceReads(() => {
      return sigA.val + sigB.val;
    }, signals);

    expect(reads).toContain('a');
    expect(reads).toContain('b');
    expect(result).toBe('42hello');
    // Originals restored
    expect(sigA.val).toBe(42);
  });
});

describe('parseComputeFn', () => {
  it('extracts .val signal reads', () => {
    const fn = () => foo.val + bar.val;
    // @ts-ignore - we don't need these to exist, we just parse the source
    const parsed = parseComputeFn(fn as any);
    expect(parsed).not.toBeNull();
    expect(parsed!.signals).toContain('foo');
    expect(parsed!.signals).toContain('bar');
  });

  it('extracts comparisons', () => {
    const fn = () => count.val > 10;
    // @ts-ignore
    const parsed = parseComputeFn(fn as any);
    expect(parsed).not.toBeNull();
    expect(parsed!.comparisons).toHaveLength(1);
    expect(parsed!.comparisons[0].signal).toBe('count');
    expect(parsed!.comparisons[0].op).toBe('>');
    expect(parsed!.comparisons[0].value).toBe('10');
  });
});

describe('shrinkSequence', () => {
  it('shrinks to minimal reproduction', () => {
    // Violation only occurs when step 'c' is present
    const seq = [
      { signal: 'a', value: 1 },
      { signal: 'b', value: 2 },
      { signal: 'c', value: 3 },
      { signal: 'd', value: 4 },
    ];

    const minimal = shrinkSequence(seq, (candidate) => {
      return candidate.some(s => s.signal === 'c');
    });

    expect(minimal).toHaveLength(1);
    expect(minimal[0].signal).toBe('c');
  });

  it('returns original if single step', () => {
    const seq = [{ signal: 'a', value: 1 }];
    const minimal = shrinkSequence(seq, () => true);
    expect(minimal).toEqual(seq);
  });
});

describe('explore', () => {
  it('finds assertion violations', () => {
    const g = new CircuitGraph();
    let aVal = false, bVal = false;
    const a = g.registerNode({ name: 'a', type: 'signal' });
    const b = g.registerNode({ name: 'b', type: 'signal' });
    g.setNodeValue(a, () => aVal);
    g.setNodeSetter(a, (v: boolean) => { aVal = v; });
    g.setNodeValue(b, () => bVal);
    g.setNodeSetter(b, (v: boolean) => { bVal = v; });

    // Assertion: a and b should never both be true
    const assertId = g.registerNode({ name: 'mutex', type: 'assertion' });
    g.addEdge(a, assertId);
    g.addEdge(b, assertId);
    g.setAssertionFn(assertId, () => !(aVal && bVal), 'always');

    const result = explore(g, { budget: 100 });
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0].assertionName).toBe('mutex');
  });

  it('reports no violations when assertions hold', () => {
    const g = new CircuitGraph();
    let aVal = false;
    const a = g.registerNode({ name: 'a', type: 'signal' });
    g.setNodeValue(a, () => aVal);
    g.setNodeSetter(a, (v: boolean) => { aVal = v; });

    // Assertion: always passes (tautology for boolean)
    const assertId = g.registerNode({ name: 'tautology', type: 'assertion' });
    g.addEdge(a, assertId);
    g.setAssertionFn(assertId, () => true, 'always');

    const result = explore(g, { budget: 100 });
    expect(result.violations).toHaveLength(0);
  });

  it('respects budget', () => {
    const g = new CircuitGraph();
    let aVal = false, bVal = false, cVal = false;
    const a = g.registerNode({ name: 'a', type: 'signal' });
    const b = g.registerNode({ name: 'b', type: 'signal' });
    const c = g.registerNode({ name: 'c', type: 'signal' });
    g.setNodeValue(a, () => aVal);
    g.setNodeSetter(a, (v: boolean) => { aVal = v; });
    g.setNodeValue(b, () => bVal);
    g.setNodeSetter(b, (v: boolean) => { bVal = v; });
    g.setNodeValue(c, () => cVal);
    g.setNodeSetter(c, (v: boolean) => { cVal = v; });

    const assertId = g.registerNode({ name: 'test', type: 'assertion' });
    g.addEdge(a, assertId);
    g.addEdge(b, assertId);
    g.addEdge(c, assertId);
    g.setAssertionFn(assertId, () => true, 'always');

    // 3 boolean signals = 8 combos, but budget is 5
    const result = explore(g, { budget: 5 });
    expect(result.steps).toBeLessThanOrEqual(5);
  });
});
