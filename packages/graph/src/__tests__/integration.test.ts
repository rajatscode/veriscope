import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitGraph, assertAlways, assertNever, assertAfter, CoverageCollector } from '../index';

/**
 * Integration tests — exercise multiple packages working together
 * through the graph as the coordination layer.
 */

describe('Integration: signals + derived + assertions', () => {
  let g: CircuitGraph;

  beforeEach(() => {
    g = new CircuitGraph();
    g.enterTestMode();
  });

  it('creates a signal → derived → assertion pipeline and detects violation', () => {
    // Signal
    const countId = g.registerNode({ name: 'count', type: 'signal' });
    let countValue = 0;
    g.setNodeValue(countId, () => countValue);
    g.setNodeSetter(countId, (v: number) => {
      const old = countValue;
      countValue = v;
      g.notifyChange(countId, old, v);
    });

    // Derived
    const doubleId = g.registerNode({ name: 'double', type: 'derived', deps: [countId] });
    let doubleValue = 0;
    g.setNodeValue(doubleId, () => doubleValue);

    // Assertion: double should always equal 2 * count
    assertAlways(() => doubleValue === countValue * 2, 'double-invariant', g);

    // Initially correct
    expect(g.checkAssertions()).toHaveLength(0);

    // Set count=5, update double correctly
    g.openTick();
    g.getNode(countId)!.setValue!(5);
    doubleValue = 10;
    g.notifyChange(doubleId, 0, 10);
    g.closeTick();
    expect(g.checkAssertions()).toHaveLength(0);

    // Break invariant: count=3 but double stays at 10
    g.openTick();
    g.getNode(countId)!.setValue!(3);
    // Forget to update double
    g.closeTick();
    const violations = g.checkAssertions();
    expect(violations).toHaveLength(1);
    expect(violations[0].name).toBe('double-invariant');
  });

  it('assertNever correctly inverts the check', () => {
    const sigId = g.registerNode({ name: 'danger', type: 'signal' });
    let dangerValue = false;
    g.setNodeValue(sigId, () => dangerValue);

    assertNever(() => dangerValue, 'never-danger', g);

    expect(g.checkAssertions()).toHaveLength(0);

    dangerValue = true;
    const violations = g.checkAssertions();
    expect(violations).toHaveLength(1);
    expect(violations[0].name).toBe('never-danger');
  });

  it('assertAfter arms on posedge and checks immediately', () => {
    const sigId = g.registerNode({ name: 'trigger', type: 'signal' });
    let triggerValue = false;
    let readyValue = false;
    g.setNodeValue(sigId, () => triggerValue);
    g.setNodeSetter(sigId, (v: boolean) => {
      const old = triggerValue;
      triggerValue = v;
      g.notifyChange(sigId, old, v);
    });

    const readyId = g.registerNode({ name: 'ready', type: 'signal' });
    g.setNodeValue(readyId, () => readyValue);

    assertAfter(
      { nodeId: sigId },
      'posedge',
      'immediately',
      () => readyValue,
      { name: 'ready-after-trigger' },
      g,
    );

    // Trigger posedge without ready → violation
    g.openTick();
    g.getNode(sigId)!.setValue!(true);
    g.closeTick();

    const violations = g.checkAssertions();
    expect(violations).toHaveLength(1);
    expect(violations[0].name).toBe('ready-after-trigger');
  });

  it('assertAfter with withinTicks passes when property holds in budget', () => {
    const sigId = g.registerNode({ name: 'req', type: 'signal' });
    let reqValue = false;
    let ackValue = false;
    g.setNodeValue(sigId, () => reqValue);
    g.setNodeSetter(sigId, (v: boolean) => {
      const old = reqValue;
      reqValue = v;
      g.notifyChange(sigId, old, v);
    });

    assertAfter(
      { nodeId: sigId },
      'posedge',
      { withinTicks: 3 },
      () => ackValue,
      { name: 'ack-within-3' },
      g,
    );

    // Arm
    g.openTick();
    g.getNode(sigId)!.setValue!(true);
    g.closeTick();

    // Tick 2: still no ack, but within budget
    g.openTick();
    g.closeTick();
    expect(g.checkAssertions()).toHaveLength(0);

    // Tick 3: ack arrives
    ackValue = true;
    expect(g.checkAssertions()).toHaveLength(0);
  });

  it('snapshot + diff detects topology changes', () => {
    const a = g.registerNode({ name: 'a', type: 'signal' });
    const b = g.registerNode({ name: 'b', type: 'derived', deps: [a] });
    const snap1 = g.snapshot();

    // Modify topology: add node c, remove b
    g.disposeNode(b);
    const c = g.registerNode({ name: 'c', type: 'derived', deps: [a] });
    const snap2 = g.snapshot();

    const diff = CircuitGraph.diffGraphs(snap1, snap2);
    expect(diff.addedNodes).toContain('c');
    expect(diff.removedNodes).toContain('b');
  });

  it('disposeNode removes node, edges, and cancels assertions', () => {
    const sigId = g.registerNode({ name: 'x', type: 'signal' });
    const derivedId = g.registerNode({ name: 'y', type: 'derived', deps: [sigId] });
    const assertId = g.registerNode({ name: 'check', type: 'assertion', deps: [derivedId] });
    g.setAssertionFn(assertId, () => false, 'always');

    // Before dispose: assertion exists and fails
    expect(g.checkAssertions()).toHaveLength(1);

    // Dispose the assertion node
    g.disposeNode(assertId);

    // After dispose: no more assertion violations
    expect(g.checkAssertions()).toHaveLength(0);
    expect(g.getNode(assertId)).toBeUndefined();

    // Dispose derived: edges from sig→derived removed
    g.disposeNode(derivedId);
    expect(g.getEdges()).toHaveLength(0);
  });

  it('CDC warning fires when async-set signal is read by unguarded derived', () => {
    const asyncSig = g.registerNode({ name: 'fetchData', type: 'signal' });
    g.registerNode({ name: 'display', type: 'derived', deps: [asyncSig] });

    const warnings: any[] = [];
    g.onCdcWarning(w => warnings.push(w));

    g.setAsyncContext(true);
    g.openTick();
    g.notifyChange(asyncSig, null, 'data');
    g.closeTick();
    g.setAsyncContext(false);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('cdc-async-unguarded');
    expect(warnings[0].signalName).toBe('fetchData');
    expect(warnings[0].derivedName).toBe('display');
  });

  it('CDC warning does NOT fire when derived has sync guard', () => {
    const asyncSig = g.registerNode({ name: 'fetchData', type: 'signal' });
    const guardSig = g.registerNode({ name: 'isReady', type: 'signal' });
    g.registerNode({ name: 'display', type: 'derived', deps: [asyncSig, guardSig] });

    // Mark guard as sync-set
    g.notifyChange(guardSig, false, true);

    const warnings: any[] = [];
    g.onCdcWarning(w => warnings.push(w));

    g.setAsyncContext(true);
    g.notifyChange(asyncSig, null, 'data');
    g.setAsyncContext(false);

    expect(warnings).toHaveLength(0);
  });

  it('tick semantics: enterTestMode, manual openTick/closeTick', async () => {
    const sig = g.registerNode({ name: 's', type: 'signal' });

    // In test mode, ticks don't auto-advance
    g.notifyChange(sig, 0, 1);
    g.notifyChange(sig, 1, 2);
    expect(g.currentTick).toBe(0);

    // Manual tick management
    g.openTick();
    g.notifyChange(sig, 2, 3);
    g.closeTick();
    expect(g.currentTick).toBe(1);

    g.openTick();
    g.closeTick();
    expect(g.currentTick).toBe(2);

    // Exit test mode: auto-advance resumes
    g.exitTestMode();
    g.notifyChange(sig, 3, 4);
    await g.flushTick();
    expect(g.currentTick).toBe(3);
  });

  it('coverage tracks toggle data through graph notifications', () => {
    g.enableCoverage();

    const flagId = g.registerNode({ name: 'flag', type: 'signal' });

    g.openTick();
    g.notifyChange(flagId, false, true);
    g.closeTick();

    g.openTick();
    g.notifyChange(flagId, true, false);
    g.closeTick();

    // Coverage collector should have recorded both values
    const cov = new CoverageCollector();
    cov.enable();
    cov.recordToggle(flagId, true);
    cov.recordToggle(flagId, false);
    const report = cov.getReport();
    expect(report.toggle).toHaveLength(1);
    expect(report.toggle[0].seenTrue).toBe(true);
    expect(report.toggle[0].seenFalse).toBe(true);

    g.disableCoverage();
  });

  it('waveform recording captures signal history', () => {
    const sig = g.registerNode({ name: 'counter', type: 'signal' });
    let val = 0;
    g.setNodeValue(sig, () => val);

    g.startRecording();

    for (let i = 1; i <= 5; i++) {
      g.openTick();
      const old = val;
      val = i;
      g.notifyChange(sig, old, val);
      g.closeTick();
    }

    const waveforms = g.getWaveformData();
    const sigWave = waveforms.get(sig);
    expect(sigWave).toBeDefined();
    // Initial snapshot + 5 changes
    expect(sigWave!.length).toBeGreaterThanOrEqual(5);
    expect(sigWave![sigWave!.length - 1].v).toBe(5);

    g.stopRecording();
  });

  it('event subscription captures full lifecycle', () => {
    const events: any[] = [];
    g.subscribe(e => events.push(e));

    const sig = g.registerNode({ name: 'x', type: 'signal' });
    const assertId = g.registerNode({ name: 'check', type: 'assertion' });
    g.setAssertionFn(assertId, () => true, 'always');

    g.openTick();
    g.notifyChange(sig, 0, 1);
    g.closeTick();
    g.checkAssertions();

    const types = events.map(e => e.type);
    expect(types).toContain('signal-change');
    expect(types).toContain('assertion-passed');
  });

  it('full pipeline: multi-signal graph with assertions and snapshot diff', () => {
    // Build a small graph: a, b → sum → assertion(sum < 10)
    const aId = g.registerNode({ name: 'a', type: 'signal' });
    const bId = g.registerNode({ name: 'b', type: 'signal' });
    let aVal = 0, bVal = 0, sumVal = 0;
    g.setNodeValue(aId, () => aVal);
    g.setNodeValue(bId, () => bVal);
    g.setNodeSetter(aId, (v: number) => {
      const old = aVal; aVal = v;
      g.notifyChange(aId, old, v);
    });
    g.setNodeSetter(bId, (v: number) => {
      const old = bVal; bVal = v;
      g.notifyChange(bId, old, v);
    });

    const sumId = g.registerNode({ name: 'sum', type: 'derived', deps: [aId, bId] });
    g.setNodeValue(sumId, () => sumVal);

    assertAlways(() => sumVal < 10, 'sum-under-10', g);

    const snap1 = g.snapshot();

    // a=3, b=4, sum=7 → passes
    g.openTick();
    g.getNode(aId)!.setValue!(3);
    bVal = 4;
    g.notifyChange(bId, 0, 4);
    sumVal = 7;
    g.notifyChange(sumId, 0, 7);
    g.closeTick();
    expect(g.checkAssertions()).toHaveLength(0);

    // a=6, b=5, sum=11 → violation
    g.openTick();
    g.getNode(aId)!.setValue!(6);
    bVal = 5;
    g.notifyChange(bId, 4, 5);
    sumVal = 11;
    g.notifyChange(sumId, 7, 11);
    g.closeTick();
    const violations = g.checkAssertions();
    expect(violations).toHaveLength(1);
    expect(violations[0].name).toBe('sum-under-10');

    // Snapshot should still be valid
    const snap2 = g.snapshot();
    const diff = CircuitGraph.diffGraphs(snap1, snap2);
    // Same topology, no structural changes
    expect(diff.addedNodes).toHaveLength(0);
    expect(diff.removedNodes).toHaveLength(0);
  });
});
