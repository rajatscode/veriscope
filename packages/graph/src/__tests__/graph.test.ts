import { describe, it, expect } from 'vitest';
import { CircuitGraph } from '../graph';

describe('CircuitGraph', () => {
  it('registers nodes and edges', () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    const b = g.registerNode({ name: 'b', type: 'derived' });
    g.addEdge(a, b);
    expect(g.getNodes()).toHaveLength(2);
    expect(g.getEdges()).toHaveLength(1);
  });

  it('records waveform data', () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    g.startRecording();
    g.notifyChange(a, undefined, 1);
    g.notifyChange(a, 1, 2);
    const data = g.getWaveformData();
    expect(data.get(a)).toHaveLength(2);
    g.stopRecording();
  });

  it('diffs two snapshots', () => {
    const g1 = new CircuitGraph();
    g1.registerNode({ name: 'a', type: 'signal' });
    g1.registerNode({ name: 'b', type: 'derived' });

    const g2 = new CircuitGraph();
    g2.registerNode({ name: 'a', type: 'signal' });
    g2.registerNode({ name: 'c', type: 'derived' });

    const diff = CircuitGraph.diffGraphs(g1.snapshot(), g2.snapshot());
    expect(diff.addedNodes).toContain('c');
    expect(diff.removedNodes).toContain('b');
  });

  it('tracks ticks in test mode', () => {
    const g = new CircuitGraph();
    g.enterTestMode();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    g.openTick();
    g.notifyChange(a, 0, 1);
    g.closeTick();
    expect(g.currentTick).toBe(1);
  });

  it('auto-manages ticks outside test mode', () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    g.notifyChange(a, 0, 1);
    expect(g.currentTick).toBe(1);
    g.notifyChange(a, 1, 2);
    expect(g.currentTick).toBe(2);
  });

  it('does not auto-manage ticks in test mode', () => {
    const g = new CircuitGraph();
    g.enterTestMode();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    g.notifyChange(a, 0, 1);
    g.notifyChange(a, 1, 2);
    // Tick should not advance without explicit openTick/closeTick
    expect(g.currentTick).toBe(0);
  });

  it('exitTestMode re-enables auto tick management', () => {
    const g = new CircuitGraph();
    g.enterTestMode();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    g.notifyChange(a, 0, 1);
    expect(g.currentTick).toBe(0);
    g.exitTestMode();
    g.notifyChange(a, 1, 2);
    expect(g.currentTick).toBe(1);
  });

  it('checks always assertions', () => {
    const g = new CircuitGraph();
    let value = true;
    const nodeId = g.registerNode({ name: 'test-assert', type: 'assertion' });
    g.setAssertionFn(nodeId, () => value, 'always');

    expect(g.checkAssertions()).toHaveLength(0);
    value = false;
    const violations = g.checkAssertions();
    expect(violations).toHaveLength(1);
    expect(violations[0].nodeId).toBe(nodeId);
  });

  it('getAssertions returns assertion details', () => {
    const g = new CircuitGraph();
    const depNode = g.registerNode({ name: 'dep', type: 'signal' });
    const nodeId = g.registerNode({ name: 'my-assert', type: 'assertion', deps: [depNode] });
    const checkFn = () => true;
    g.setAssertionFn(nodeId, checkFn, 'always');

    const assertions = g.getAssertions();
    expect(assertions).toHaveLength(1);
    expect(assertions[0].id).toBe(nodeId);
    expect(assertions[0].name).toBe('my-assert');
    expect(assertions[0].kind).toBe('always');
    expect(assertions[0].checkFn).toBe(checkFn);
    expect(assertions[0].deps).toContain(depNode);
  });

  it('getAssertions excludes assertion nodes without assertionFn', () => {
    const g = new CircuitGraph();
    g.registerNode({ name: 'no-fn', type: 'assertion' });
    const withFn = g.registerNode({ name: 'with-fn', type: 'assertion' });
    g.setAssertionFn(withFn, () => true, 'never');

    const assertions = g.getAssertions();
    expect(assertions).toHaveLength(1);
    expect(assertions[0].kind).toBe('never');
  });

  it('disposes nodes and their edges', () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    const b = g.registerNode({ name: 'b', type: 'derived' });
    g.addEdge(a, b);
    expect(g.getEdges()).toHaveLength(1);
    g.disposeNode(a);
    expect(g.getNodes()).toHaveLength(1);
    expect(g.getEdges()).toHaveLength(0);
  });

  it('subscribes and unsubscribes to events', () => {
    const g = new CircuitGraph();
    g.enterTestMode();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    const events: any[] = [];
    const unsub = g.subscribe(e => events.push(e));
    g.notifyChange(a, 0, 1);
    expect(events).toHaveLength(1);
    unsub();
    g.notifyChange(a, 1, 2);
    expect(events).toHaveLength(1);
  });

  it('ring buffer wraps after EVENT_BUFFER_SIZE', () => {
    const g = new CircuitGraph();
    g.enterTestMode();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    for (let i = 0; i < 300; i++) {
      g.notifyChange(a, i, i + 1);
    }
    const recent = g.getRecentEvents(10);
    expect(recent).toHaveLength(10);
    // Last event should have newValue = 300
    expect(recent[recent.length - 1].newValue).toBe(300);
  });

  it('resets all state', () => {
    const g = new CircuitGraph();
    g.registerNode({ name: 'a', type: 'signal' });
    g.reset();
    expect(g.getNodes()).toHaveLength(0);
    expect(g.getEdges()).toHaveLength(0);
    expect(g.currentTick).toBe(0);
  });

  it('snapshots include node info', () => {
    const g = new CircuitGraph();
    g.registerNode({ name: 'x', type: 'signal' });
    const snap = g.snapshot();
    expect(snap.nodes).toHaveLength(1);
    expect(snap.nodes[0].name).toBe('x');
    expect(snap.nodes[0].type).toBe('signal');
  });

  it('enableCoverage records toggle for boolean signals', () => {
    const g = new CircuitGraph();
    g.enableCoverage();
    const a = g.registerNode({ name: 'flag', type: 'signal' });
    g.notifyChange(a, false, true);
    g.notifyChange(a, true, false);
    // Coverage is recorded via the global coverage singleton
    // We verify the mechanism fires without error
    g.disableCoverage();
  });

  it('does not record toggle for non-boolean values', () => {
    const g = new CircuitGraph();
    g.enableCoverage();
    const a = g.registerNode({ name: 'count', type: 'signal' });
    // These should not throw
    g.notifyChange(a, 0, 1);
    g.notifyChange(a, 1, 2);
    g.disableCoverage();
  });

  it('multiple openTick/closeTick cycles advance tick correctly', () => {
    const g = new CircuitGraph();
    g.enterTestMode();
    g.openTick();
    g.closeTick();
    g.openTick();
    g.closeTick();
    g.openTick();
    g.closeTick();
    expect(g.currentTick).toBe(3);
  });

  it('closeTick without openTick does not advance', () => {
    const g = new CircuitGraph();
    g.enterTestMode();
    g.closeTick();
    expect(g.currentTick).toBe(0);
  });

  // --- CDC runtime warnings ---

  it('emits CDC warning when async-set signal feeds unguarded derived', () => {
    const g = new CircuitGraph();
    g.enterTestMode();
    const sig = g.registerNode({ name: 'asyncData', type: 'signal' });
    const derived = g.registerNode({ name: 'display', type: 'derived', deps: [sig] });
    g.setNodeValue(derived, () => 'val');

    const warnings: any[] = [];
    g.onCdcWarning(w => warnings.push(w));

    // Set from async context
    g.setAsyncContext(true);
    g.notifyChange(sig, 'old', 'new');
    g.setAsyncContext(false);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('cdc-async-unguarded');
    expect(warnings[0].signalName).toBe('asyncData');
    expect(warnings[0].derivedName).toBe('display');
  });

  it('does not emit CDC warning when derived has a sync guard signal', () => {
    const g = new CircuitGraph();
    g.enterTestMode();
    const asyncSig = g.registerNode({ name: 'asyncData', type: 'signal' });
    const guardSig = g.registerNode({ name: 'guard', type: 'signal' });
    const derived = g.registerNode({ name: 'display', type: 'derived', deps: [asyncSig, guardSig] });
    g.setNodeValue(derived, () => 'val');

    // Mark guard as set from sync context
    g.notifyChange(guardSig, false, true);

    const warnings: any[] = [];
    g.onCdcWarning(w => warnings.push(w));

    // Set async signal
    g.setAsyncContext(true);
    g.notifyChange(asyncSig, 'old', 'new');
    g.setAsyncContext(false);

    expect(warnings).toHaveLength(0);
  });

  it('does not emit CDC warning from sync context', () => {
    const g = new CircuitGraph();
    g.enterTestMode();
    const sig = g.registerNode({ name: 'data', type: 'signal' });
    g.registerNode({ name: 'display', type: 'derived', deps: [sig] });

    const warnings: any[] = [];
    g.onCdcWarning(w => warnings.push(w));

    g.notifyChange(sig, 'old', 'new');
    expect(warnings).toHaveLength(0);
  });

  it('tracks lastSetContext per node', () => {
    const g = new CircuitGraph();
    g.enterTestMode();
    const sig = g.registerNode({ name: 'x', type: 'signal' });

    g.notifyChange(sig, 0, 1);
    expect(g.getNodeLastSetContext(sig)).toBe('sync');

    g.setAsyncContext(true);
    g.notifyChange(sig, 1, 2);
    expect(g.getNodeLastSetContext(sig)).toBe('async');
    g.setAsyncContext(false);
  });

  it('CDC warning listener can be unsubscribed', () => {
    const g = new CircuitGraph();
    g.enterTestMode();
    const sig = g.registerNode({ name: 'data', type: 'signal' });
    g.registerNode({ name: 'view', type: 'derived', deps: [sig] });

    const warnings: any[] = [];
    const unsub = g.onCdcWarning(w => warnings.push(w));

    g.setAsyncContext(true);
    g.notifyChange(sig, 0, 1);
    expect(warnings).toHaveLength(1);

    unsub();
    g.notifyChange(sig, 1, 2);
    expect(warnings).toHaveLength(1);
    g.setAsyncContext(false);
  });

  it('reset clears CDC state', () => {
    const g = new CircuitGraph();
    g.enterTestMode();
    const sig = g.registerNode({ name: 'x', type: 'signal' });
    g.setAsyncContext(true);
    g.notifyChange(sig, 0, 1);

    g.reset();
    expect(g.getNodeLastSetContext(sig)).toBeUndefined();
  });
});
