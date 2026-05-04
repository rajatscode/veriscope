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

  it('generates swap-edge mutations for same-type signals', () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    const b = g.registerNode({ name: 'b', type: 'signal' });
    g.setNodeValue(a, () => 1);
    g.setNodeValue(b, () => 2);

    const mutations = generateMutations(g);
    const swapMuts = mutations.filter(m => m.name.startsWith('swap-edge:'));
    expect(swapMuts.length).toBeGreaterThan(0);

    // Apply swap: a should now read b's value
    const undo = swapMuts[0].apply(g);
    expect(g.getNode(a)!.getValue!()).toBe(2);
    undo();
    expect(g.getNode(a)!.getValue!()).toBe(1);
  });

  it('generates skip-effect mutations', () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    const e = g.registerNode({ name: 'myEffect', type: 'effect' });
    g.addEdge(a, e);
    let ran = false;
    g.setNodeValue(e, () => { ran = true; });

    const mutations = generateMutations(g);
    const skipMuts = mutations.filter(m => m.name.startsWith('skip-effect:'));
    expect(skipMuts.length).toBeGreaterThan(0);

    // Apply skip: effect should be a no-op
    ran = false;
    const undo = skipMuts[0].apply(g);
    g.getNode(e)!.getValue!();
    expect(ran).toBe(false);
    undo();
    g.getNode(e)!.getValue!();
    expect(ran).toBe(true);
  });

  it('generates invert-comparison mutations for boolean derived nodes', () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    const d = g.registerNode({ name: 'isPositive', type: 'derived' });
    g.addEdge(a, d);
    g.setNodeValue(a, () => 5);
    g.setNodeValue(d, () => true);

    const mutations = generateMutations(g);
    const invertMuts = mutations.filter(m => m.name.startsWith('invert-comparison:'));
    expect(invertMuts.length).toBeGreaterThan(0);

    const undo = invertMuts[0].apply(g);
    expect(g.getNode(d)!.getValue!()).toBe(false);
    undo();
    expect(g.getNode(d)!.getValue!()).toBe(true);
  });

  it('generates remove-assertion mutations', () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    const assertId = g.registerNode({ name: 'myAssert', type: 'assertion' });
    g.addEdge(a, assertId);
    g.setAssertionFn(assertId, () => false, 'always');

    const mutations = generateMutations(g);
    const removeMuts = mutations.filter(m => m.name.startsWith('remove-assertion:'));
    expect(removeMuts.length).toBeGreaterThan(0);

    // Before: assertion fails
    expect(g.getNode(assertId)!.assertionFn!()).toBe(false);
    // Apply: assertion disabled (always passes)
    const undo = removeMuts[0].apply(g);
    expect(g.getNode(assertId)!.assertionFn!()).toBe(true);
    undo();
    expect(g.getNode(assertId)!.assertionFn!()).toBe(false);
  });

  it('generates delay-effect mutations', () => {
    const g = new CircuitGraph();
    const e = g.registerNode({ name: 'delayMe', type: 'effect' });
    let callOrder: string[] = [];
    g.setNodeValue(e, () => { callOrder.push('immediate'); });

    const mutations = generateMutations(g);
    const delayMuts = mutations.filter(m => m.name.startsWith('delay-effect:'));
    expect(delayMuts.length).toBeGreaterThan(0);

    // Apply: the effect should be wrapped in setTimeout
    callOrder = [];
    const undo = delayMuts[0].apply(g);
    g.getNode(e)!.getValue!();
    // Immediate call list should be empty (queued to next tick)
    expect(callOrder).toEqual([]);
    undo();
  });
});

describe('mutate', () => {
  it('detects well-asserted graphs (mutations killed)', async () => {
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

    const result = await mutate(factory, { budget: 100 });
    expect(result.killed).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThan(0);
  });

  it('reports survived mutations for weak assertions', async () => {
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

    const result = await mutate(factory, { budget: 100 });
    // With a tautological assertion, no mutations should be killed
    expect(result.survived.length).toBe(result.total);
    expect(result.score).toBe(0);
  });

  it('filters by operator type', async () => {
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

    const result = await mutate(factory, { budget: 100, operators: ['negate'] });
    // Only negate mutations should be tested
    for (const s of result.survived) {
      expect(s.mutation).toMatch(/^negate:/);
    }
  });
});
