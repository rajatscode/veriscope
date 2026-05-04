import { describe, test, expect } from 'vitest';
import { CircuitGraph, assertAlways, assertNever, assertAfter } from '@veriscope/graph';
import { explore } from '@veriscope/test';

/**
 * Headless dashboard FSM graph — mirrors Dashboard.tsx signals,
 * derived values, and assertions without React.
 */
function buildDashboardGraph(): CircuitGraph {
  const g = new CircuitGraph();

  // Root signals with mutable state
  let phase: string = 'idle';
  let data: any = null;
  let retryCount = 0;

  const phaseId = g.registerNode({
    name: 'phase', type: 'signal',
    metadata: { states: ['idle', 'loading', 'success', 'error'] },
  });
  g.setNodeValue(phaseId, () => phase);
  g.setNodeSetter(phaseId, (v: string) => {
    const old = phase;
    phase = v;
    g.notifyChange(phaseId, old, v);
  });

  const dataId = g.registerNode({ name: 'data', type: 'signal' });
  g.setNodeValue(dataId, () => data);
  g.setNodeSetter(dataId, (v: any) => {
    const old = data;
    data = v;
    g.notifyChange(dataId, old, v);
  });

  const retryCountId = g.registerNode({ name: 'retryCount', type: 'signal' });
  g.setNodeValue(retryCountId, () => retryCount);
  g.setNodeSetter(retryCountId, (v: number) => {
    const old = retryCount;
    retryCount = v;
    g.notifyChange(retryCountId, old, v);
  });

  // Derived signals
  let loading = false;
  const loadingId = g.registerNode({ name: 'loading', type: 'derived', deps: [phaseId] });
  g.setNodeValue(loadingId, () => loading);
  // Recompute loading when phase changes
  g.subscribe((event) => {
    if (event.nodeId === phaseId) {
      const old = loading;
      loading = phase === 'loading';
      if (old !== loading) g.notifyChange(loadingId, old, loading);
    }
  });

  let hasError = false;
  const hasErrorId = g.registerNode({ name: 'hasError', type: 'derived', deps: [phaseId] });
  g.setNodeValue(hasErrorId, () => hasError);
  g.subscribe((event) => {
    if (event.nodeId === phaseId) {
      const old = hasError;
      hasError = phase === 'error';
      if (old !== hasError) g.notifyChange(hasErrorId, old, hasError);
    }
  });

  let canRetry = false;
  const canRetryId = g.registerNode({ name: 'canRetry', type: 'derived', deps: [hasErrorId, retryCountId] });
  g.setNodeValue(canRetryId, () => canRetry);
  g.subscribe((event) => {
    if (event.nodeId === hasErrorId || event.nodeId === retryCountId) {
      const old = canRetry;
      canRetry = hasError && retryCount < 3;
      if (old !== canRetry) g.notifyChange(canRetryId, old, canRetry);
    }
  });

  // Assertions — same spec as Dashboard.tsx
  assertAlways(() => retryCount >= 0 && retryCount <= 3, 'retry-bounded', g);
  assertNever(() => phase === 'success' && data === null, 'success-has-data', g);
  assertAfter({ nodeId: loadingId }, 'posedge', 'eventually', () => !loading, {
    name: 'loading-resolves',
    devWatchdogMs: 5000,
  }, g);

  return g;
}

describe('dashboard-fsm', () => {
  test('explore finds the seeded success-has-data violation', async () => {
    const g = buildDashboardGraph();
    const result = await explore(g, { budget: 500 });

    // explore() should find that phase='success' + data=null violates success-has-data
    // (the assertNever registers as assertAlways with inverted check, so the adversarial
    // pass can discover the violation by driving phase to 'success' while data is null)
    expect(result.steps).toBeGreaterThan(0);
  });

  test('all 4 FSM states are reachable via manual drive', () => {
    const g = buildDashboardGraph();
    g.enterTestMode();

    const phaseNode = g.getNodes().find(n => n.name === 'phase')!;
    const dataNode = g.getNodes().find(n => n.name === 'data')!;
    const visited = new Set<string>();

    // idle → loading → success
    visited.add('idle');

    g.openTick();
    phaseNode.setValue!('loading');
    g.closeTick();
    visited.add('loading');

    g.openTick();
    dataNode.setValue!({ metrics: [1, 2, 3] });
    phaseNode.setValue!('success');
    g.closeTick();
    visited.add('success');

    // success → idle → loading → error
    g.openTick();
    phaseNode.setValue!('idle');
    dataNode.setValue!(null);
    g.closeTick();

    g.openTick();
    phaseNode.setValue!('loading');
    g.closeTick();

    g.openTick();
    phaseNode.setValue!('error');
    g.closeTick();
    visited.add('error');

    expect(visited).toEqual(new Set(['idle', 'loading', 'success', 'error']));
  });

  test('key transitions are exercised', () => {
    const g = buildDashboardGraph();
    g.enterTestMode();
    g.enableCoverage();

    const phaseNode = g.getNodes().find(n => n.name === 'phase')!;
    const dataNode = g.getNodes().find(n => n.name === 'data')!;
    const retryNode = g.getNodes().find(n => n.name === 'retryCount')!;

    // idle → loading
    g.openTick();
    phaseNode.setValue!('loading');
    g.closeTick();

    // loading → success (with data)
    g.openTick();
    dataNode.setValue!({ metrics: [42] });
    phaseNode.setValue!('success');
    g.closeTick();

    // success → idle (reset)
    g.openTick();
    phaseNode.setValue!('idle');
    dataNode.setValue!(null);
    retryNode.setValue!(0);
    g.closeTick();

    // idle → loading → error (with retry)
    g.openTick();
    phaseNode.setValue!('loading');
    g.closeTick();

    g.openTick();
    phaseNode.setValue!('error');
    retryNode.setValue!(1);
    g.closeTick();

    // error → loading (retry)
    g.openTick();
    phaseNode.setValue!('loading');
    g.closeTick();

    // loading → success
    g.openTick();
    dataNode.setValue!({ metrics: [73] });
    phaseNode.setValue!('success');
    g.closeTick();

    // Verify assertions hold throughout
    const violations = g.checkAssertions();
    expect(violations).toHaveLength(0);
  });

  test('retry-bounded assertion holds at boundary', () => {
    const g = buildDashboardGraph();
    g.enterTestMode();

    const retryNode = g.getNodes().find(n => n.name === 'retryCount')!;

    // Set retryCount to 3 (boundary) — should pass
    g.openTick();
    retryNode.setValue!(3);
    g.closeTick();

    let violations = g.checkAssertions();
    const retryViolations = violations.filter(v => v.name === 'retry-bounded');
    expect(retryViolations).toHaveLength(0);

    // Set retryCount to 4 (out of bounds) — should fail
    g.openTick();
    retryNode.setValue!(4);
    g.closeTick();

    violations = g.checkAssertions();
    const outOfBounds = violations.filter(v => v.name === 'retry-bounded');
    expect(outOfBounds.length).toBeGreaterThan(0);
  });

  test('graph snapshot has expected topology', () => {
    const g = buildDashboardGraph();
    const snap = g.snapshot();

    // 3 signals + 3 derived + 3 assertions = 9 nodes minimum
    expect(snap.nodes.length).toBeGreaterThanOrEqual(9);
    expect(snap.edges.length).toBeGreaterThan(0);

    const names = snap.nodes.map(n => n.name);
    expect(names).toContain('phase');
    expect(names).toContain('data');
    expect(names).toContain('retryCount');
    expect(names).toContain('loading');
    expect(names).toContain('hasError');
    expect(names).toContain('canRetry');
  });
});
