import { describe, it, expect } from 'vitest';
import { CircuitGraph } from '@veriscope/graph';
import { generateMutations } from '../operators';
import { mutate } from '../mutate';

describe('generateMutations', () => {
  it('generates sever-edge mutations', () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    const b = g.registerNode({ name: 'b', type: 'derived' });
    g.addEdge(a, b);
    g.setNodeValue(a, () => true);

    const mutations = generateMutations(g);
    expect(mutations.some(m => m.name.includes('sever-edge'))).toBe(true);
  });

  it('generates negate mutations for booleans', () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    g.setNodeValue(a, () => true);

    const mutations = generateMutations(g);
    expect(mutations.some(m => m.name.includes('negate'))).toBe(true);
  });

  it('generates constant-fold mutations for derived nodes', () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    const d = g.registerNode({ name: 'd', type: 'derived' });
    g.addEdge(a, d);
    g.setNodeValue(a, () => true);
    g.setNodeValue(d, () => true);

    const mutations = generateMutations(g);
    expect(mutations.some(m => m.name.includes('constant-fold'))).toBe(true);
  });

  it('sever-edge mutation replaces value and undo restores it', () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    const b = g.registerNode({ name: 'b', type: 'derived' });
    g.addEdge(a, b);
    g.setNodeValue(a, () => true);

    const mutations = generateMutations(g);
    const severMut = mutations.find(m => m.name.includes('sever-edge'))!;

    const undo = severMut.apply(g);
    expect(g.getNode(a)!.getValue!()).toBe(false); // severed to default
    undo();
    expect(g.getNode(a)!.getValue!()).toBe(true); // restored
  });
});

describe('mutate', () => {
  it('detects well-asserted graphs (mutations killed)', () => {
    const factory = () => {
      const g = new CircuitGraph();
      let val = true;
      const a = g.registerNode({ name: 'a', type: 'signal' });
      g.setNodeValue(a, () => val);
      g.setNodeSetter(a, (v: boolean) => { val = v; });

      const assertId = g.registerNode({ name: 'a-must-be-true', type: 'assertion' });
      g.addEdge(a, assertId);
      g.setAssertionFn(assertId, () => val === true, 'always');

      return g;
    };

    const result = mutate(factory, { budget: 100 });
    expect(result.killed).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThan(0);
  });

  it('reports survived mutations for weak assertions', () => {
    const factory = () => {
      const g = new CircuitGraph();
      let aVal = false, bVal = false;
      const a = g.registerNode({ name: 'a', type: 'signal' });
      const b = g.registerNode({ name: 'b', type: 'signal' });
      g.setNodeValue(a, () => aVal);
      g.setNodeSetter(a, (v: boolean) => { aVal = v; });
      g.setNodeValue(b, () => bVal);
      g.setNodeSetter(b, (v: boolean) => { bVal = v; });

      // Weak assertion: always passes
      const assertId = g.registerNode({ name: 'weak', type: 'assertion' });
      g.addEdge(a, assertId);
      g.addEdge(b, assertId);
      g.setAssertionFn(assertId, () => true, 'always');

      return g;
    };

    const result = mutate(factory, { budget: 100 });
    // With a tautological assertion, no mutations should be killed
    expect(result.survived.length).toBe(result.total);
    expect(result.score).toBe(0);
  });

  it('filters by operator type', () => {
    const factory = () => {
      const g = new CircuitGraph();
      let val = true;
      const a = g.registerNode({ name: 'a', type: 'signal' });
      g.setNodeValue(a, () => val);
      g.setNodeSetter(a, (v: boolean) => { val = v; });

      const d = g.registerNode({ name: 'd', type: 'derived' });
      g.addEdge(a, d);
      g.setNodeValue(d, () => val);

      const assertId = g.registerNode({ name: 'check', type: 'assertion' });
      g.addEdge(d, assertId);
      g.setAssertionFn(assertId, () => val === true, 'always');

      return g;
    };

    const result = mutate(factory, { budget: 100, operators: ['negate'] });
    // Only negate mutations should be tested
    for (const s of result.survived) {
      expect(s.mutation).toMatch(/^negate:/);
    }
  });
});
