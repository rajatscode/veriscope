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

  it('tracks ticks', () => {
    const g = new CircuitGraph();
    g.enterTestMode();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    g.openTick();
    g.notifyChange(a, 0, 1);
    g.closeTick();
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
});
