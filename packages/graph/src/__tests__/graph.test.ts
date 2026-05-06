import { describe, it, expect } from 'vitest';
import { CircuitGraph } from '../graph';
import { coverage } from '../coverage';
import { assertAfter, assertAlways, assertNoStaleOperations, assertOperationStatus } from '../assertions';

describe('CircuitGraph', () => {
  it('can disable instrumentation so graph APIs become no-ops', () => {
    const g = new CircuitGraph();
    g.disableInstrumentation();

    const id = g.registerNode({ name: 'count', type: 'signal' });
    g.setNodeValue(id, () => 1);
    g.setNodeSetter(id, () => {});
    g.driveNodeValue(id, 2);
    g.notifyChange(id, 1, 2);

    expect(g.isInstrumentationEnabled()).toBe(false);
    expect(g.getNodes()).toHaveLength(0);
    expect(g.getEdges()).toHaveLength(0);
    expect(g.getRecentEvents()).toHaveLength(0);
    expect(g.checkAssertions()).toEqual([]);
  });

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

  it('propagates headless derived nodes in dependency order', () => {
    const g = new CircuitGraph();
    g.enterTestMode();

    let aVal = false;
    const a = g.registerNode({ name: 'a', type: 'signal' });
    g.setNodeValue(a, () => aVal);
    g.setNodeSetter(a, (next: boolean) => {
      aVal = next;
    });

    const b = g.registerNode({
      name: 'notA',
      type: 'derived',
      deps: [a],
      computeFn: () => !aVal,
    });
    const c = g.registerNode({
      name: 'label',
      type: 'derived',
      deps: [b],
      computeFn: () => g.getNode(b)!.getValue!() ? 'enabled' : 'disabled',
    });

    expect(g.getNode(b)!.getValue!()).toBe(true);
    expect(g.getNode(c)!.getValue!()).toBe('enabled');

    const events: string[] = [];
    g.subscribe(event => {
      if (event.type === 'derived-recompute') events.push(event.nodeId);
    });

    g.openTick();
    g.driveNodeValue(a, true);

    expect(g.getNode(b)!.getValue!()).toBe(false);
    expect(g.getNode(c)!.getValue!()).toBe('disabled');
    expect(events).toEqual([b, c]);

    g.closeTick();
    g.exitTestMode();
  });

  it('resolves updater functions when driving headless signal nodes', () => {
    const g = new CircuitGraph();
    let count = 1;
    const countId = g.registerNode({ name: 'count', type: 'signal' });
    g.setNodeValue(countId, () => count);
    g.setNodeSetter(countId, (next: number) => {
      count = next;
    });

    g.driveNodeValue(countId, (prev: number) => prev + 2);

    expect(count).toBe(3);
    expect(g.getNode(countId)?.getValue?.()).toBe(3);
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

  it('diffs node metadata and dependency changes by stable path', () => {
    const g1 = new CircuitGraph();
    g1.registerNode({ name: 'field', type: 'signal', stablePath: 'Form/field', metadata: { states: ['idle'] } });

    const g2 = new CircuitGraph();
    g2.registerNode({ name: 'field', type: 'signal', stablePath: 'Form/field', metadata: { states: ['idle', 'dirty'] } });

    const diff = CircuitGraph.diffGraphs(g1.snapshot(), g2.snapshot());

    expect(diff.changedNodes).toHaveLength(1);
    expect(diff.changedNodes[0].id).toBe('Form/field');
  });

  it('tracks ticks in test mode', () => {
    const g = new CircuitGraph();
    g.enterTestMode();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    g.openTick();
    g.notifyChange(a, 0, 1);
    g.closeTick();
    expect(g.currentTick).toBe(1);
    expect(g.getRecentEvents(1)[0].seq).toBe(1);
  });

  it('batches synchronous changes into one auto-managed tick outside test mode', async () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    g.notifyChange(a, 0, 1);
    g.notifyChange(a, 1, 2);
    expect(g.currentTick).toBe(0);

    await g.flushTick();

    expect(g.currentTick).toBe(1);
    const events = g.getRecentEvents(2);
    expect(events).toHaveLength(2);
    expect(events[0].tick).toBe(0);
    expect(events[1].tick).toBe(0);
  });

  it('starts a new tick for async continuations after a flush', async () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });

    g.notifyChange(a, 0, 1);
    await g.flushTick();

    g.notifyChange(a, 1, 2);
    await g.flushTick();

    expect(g.currentTick).toBe(2);
    const events = g.getRecentEvents(2);
    expect(events[0].tick).toBe(0);
    expect(events[1].tick).toBe(1);
  });

  it('flushTick closes changes emitted by the adapter settle callback', async () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });

    g.notifyChange(a, 0, 1);
    await g.flushTick(() => {
      g.notifyChange(a, 1, 2);
    });

    expect(g.currentTick).toBe(2);
    const events = g.getRecentEvents(2);
    expect(events[0].tick).toBe(0);
    expect(events[1].tick).toBe(1);
  });

  it('keeps nested openTick calls in the same tick', () => {
    const g = new CircuitGraph();
    g.enterTestMode();
    const a = g.registerNode({ name: 'a', type: 'signal' });

    g.openTick();
    g.notifyChange(a, 0, 1);
    g.openTick();
    g.notifyChange(a, 1, 2);
    g.closeTick();

    expect(g.currentTick).toBe(1);
    const events = g.getRecentEvents(2);
    expect(events[0].tick).toBe(0);
    expect(events[1].tick).toBe(0);
  });

  it('runInTick batches synchronous causality and closes deterministically', () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    const events: any[] = [];
    g.subscribe(event => {
      if (event.type === 'signal-change') events.push(event);
    });

    g.runInTick(() => {
      g.notifyChange(a, 0, 1);
      g.notifyChange(a, 1, 2);
      expect(g.currentTick).toBe(0);
    });

    expect(g.currentTick).toBe(1);
    expect(events).toHaveLength(2);
    expect(events[0].tick).toBe(0);
    expect(events[1].tick).toBe(0);
  });

  it('runInTick does not merge awaited continuations into the initiating tick', async () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    const events: any[] = [];
    g.subscribe(event => {
      if (event.type === 'signal-change') events.push(event);
    });

    const task = g.runInTick(async () => {
      g.notifyChange(a, 0, 1);
      await Promise.resolve();
      g.notifyChange(a, 1, 2);
    });

    expect(g.currentTick).toBe(1);
    await task;
    await g.flushTick();

    expect(g.currentTick).toBe(2);
    expect(events).toHaveLength(2);
    expect(events[0].tick).toBe(0);
    expect(events[1].tick).toBe(1);
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

  it('exitTestMode re-enables auto tick management', async () => {
    const g = new CircuitGraph();
    g.enterTestMode();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    g.notifyChange(a, 0, 1);
    expect(g.currentTick).toBe(0);
    g.exitTestMode();
    g.notifyChange(a, 1, 2);
    await g.flushTick();
    expect(g.currentTick).toBe(1);
  });

  it('checks assertions when an auto-managed tick closes', async () => {
    const g = new CircuitGraph();
    const sig = g.registerNode({ name: 'sig', type: 'signal' });
    let ok = true;
    const assertId = g.registerNode({ name: 'ok', type: 'assertion', deps: [sig] });
    g.setAssertionFn(assertId, () => ok, 'always');

    const events: any[] = [];
    g.subscribe(e => events.push(e));

    ok = false;
    g.notifyChange(sig, true, false);
    await g.flushTick();

    expect(events.some(e => e.type === 'assertion-failed' && e.tick === 0)).toBe(true);
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

  it('assertAlways registers check dependency metadata by default', () => {
    const g = new CircuitGraph();
    const ready = g.registerNode({ name: 'ready', type: 'signal' });

    const assertionId = assertAlways(() => true, 'ready-visible', g, [{ nodeId: ready }]);
    const assertion = g.getAssertions().find(entry => entry.id === assertionId);

    expect(assertion?.metadata?.checkDeps).toEqual([ready]);
    expect(assertion?.metadata?.partial).toBe(false);
    expect(assertion?.metadata?.reason).toBeUndefined();
  });

  it('assertAfter accepts explicit property dependency metadata', () => {
    const g = new CircuitGraph();
    const submitted = g.registerNode({ name: 'submitted', type: 'signal' });
    const loading = g.registerNode({ name: 'loading', type: 'signal' });

    const assertionId = assertAfter(
      { nodeId: submitted },
      'posedge',
      'immediately',
      () => true,
      {
        name: 'submit-starts-loading',
        checkDeps: [{ nodeId: loading }],
        domains: { [submitted]: [false, true], [loading]: [false, true] },
      },
      g,
    );
    const assertion = g.getAssertions().find(entry => entry.id === assertionId);

    expect(assertion?.deps).toEqual([submitted, loading]);
    expect(assertion?.metadata?.triggerDeps).toEqual([submitted]);
    expect(assertion?.metadata?.checkDeps).toEqual([loading]);
    expect(assertion?.metadata?.partial).toBe(false);
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

  it('preserves subscribers across reset and emits graph-reset', () => {
    const g = new CircuitGraph();
    const events: any[] = [];
    g.subscribe(e => events.push(e));
    g.registerNode({ name: 'before', type: 'signal' });

    g.reset();
    g.registerNode({ name: 'after', type: 'signal' });

    expect(events.some(event => event.type === 'graph-reset')).toBe(true);
    expect(events.some(event => event.type === 'node-created' && event.metadata?.name === 'after')).toBe(true);
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

  it('clears coverage data on graph reset', () => {
    const g = new CircuitGraph();
    coverage.reset();
    g.enableCoverage();
    const flag = g.registerNode({ name: 'flag', type: 'signal' });
    g.notifyChange(flag, false, true);
    expect(coverage.getReport().toggle).toHaveLength(1);

    g.reset();

    expect(coverage.getReport().toggle).toHaveLength(0);
    expect(coverage.getReport().numericActivity).toHaveLength(0);
  });

  it('snapshots include node info', () => {
    const g = new CircuitGraph();
    g.registerNode({ name: 'x', type: 'signal' });
    const snap = g.snapshot();
    expect(snap.nodes).toHaveLength(1);
    expect(snap.nodes[0].name).toBe('x');
    expect(snap.nodes[0].type).toBe('signal');
  });

  it('snapshots use stable paths and keep repeated instances distinct', () => {
    const g = new CircuitGraph();
    g.registerNode({ name: 'cell.value', type: 'signal', stablePath: 'Board/Cell:a/value' });
    g.registerNode({ name: 'cell.value', type: 'signal', stablePath: 'Board/Cell:b/value' });
    g.registerNode({ name: 'status', type: 'signal', metadata: { scope: 'Board' } });
    g.registerNode({ name: 'status', type: 'signal', metadata: { scope: 'Board' } });

    const snap = g.snapshot({ fixture: 'stable-path-test' });
    const paths = snap.nodes.map(n => n.stablePath);

    expect(snap.schemaVersion).toBe(1);
    expect(snap.captureContext?.fixture).toBe('stable-path-test');
    expect(paths).toContain('Board/Cell:a/value');
    expect(paths).toContain('Board/Cell:b/value');
    expect(paths).toContain('Board/status');
    expect(paths).toContain('Board/status[1]');
  });

  it('preserves waveform history and records an end marker when disposing nodes', () => {
    const g = new CircuitGraph();
    let value = false;
    const flag = g.registerNode({ name: 'flag', type: 'signal' });
    g.setNodeValue(flag, () => value);

    g.startRecording();
    value = true;
    g.notifyChange(flag, false, true);
    g.disposeNode(flag);

    expect(g.getNode(flag)).toBeUndefined();
    const wave = g.getWaveformData().get(flag);
    expect(wave).toBeDefined();
    expect(wave?.at(-1)?.lifecycle).toBe('ended');

    const snap = g.snapshot();
    expect(snap.disposedNodes?.some(n => n.runtimeId === flag && n.disposedAtTick !== undefined)).toBe(true);
    expect(snap.waveforms?.flag?.at(-1)?.lifecycle).toBe('ended');
  });

  it('records external operation spans and links response-side events', () => {
    const g = new CircuitGraph();
    g.enterTestMode();
    const status = g.registerNode({ name: 'status', type: 'signal' });
    let statusValue = 'idle';
    g.setNodeValue(status, () => statusValue);
    g.setNodeSetter(status, (next: string) => {
      statusValue = next;
    });

    g.openTick();
    const op = g.beginOperation('submit', { outcomes: ['resolved', 'rejected', 'timeout'] });
    g.closeTick();

    g.openTick();
    g.resolveOperation(op, { ok: true });
    g.withOperation(op, () => {
      g.driveNodeValue(status, 'success');
    });
    g.closeTick();

    const [span] = g.getOperations();
    expect(span.name).toBe('submit');
    expect(span.startedAtTick).toBe(0);
    expect(span.completedAtTick).toBe(1);
    expect(span.status).toBe('resolved');
    expect(span.events.some(e => e.type === 'signal-change' && e.operationId === op)).toBe(true);
    const snap = g.snapshot();
    expect(snap.operations?.[0].inputDepPaths).toBeUndefined();
    expect(snap.operations?.[0].outputDepPaths).toBeUndefined();
    expect(snap.operations?.[0].events.some(e => e.operationId === op && e.stablePath?.startsWith('operation:submit/'))).toBe(true);
  });

  it('snapshots operation dependency paths and event sequence numbers', () => {
    const g = new CircuitGraph();
    const request = g.registerNode({ name: 'request.key', type: 'signal', stablePath: 'Search/requestKey' });
    const result = g.registerNode({ name: 'result', type: 'signal', stablePath: 'Search/result' });

    const op = g.beginOperation('search', {
      outcomes: ['resolved', 'rejected'],
      inputDeps: [request],
      outputDeps: [result],
      request: { query: 'abc' },
      onResponse: () => 'not serializable',
    });
    g.resolveOperation(op, { rows: [] });

    const snap = g.snapshot({ route: '/search' });

    expect(snap.captureContext?.route).toBe('/search');
    expect(snap.events?.every(event => typeof event.seq === 'number')).toBe(true);
    expect(snap.operations?.[0].inputDepPaths).toEqual(['Search/requestKey']);
    expect(snap.operations?.[0].outputDepPaths).toEqual(['Search/result']);
    expect(snap.operations?.[0].metadata).not.toHaveProperty('onResponse');
  });

  it('keeps async response-side graph events linked to their operation', async () => {
    const g = new CircuitGraph();
    g.enterTestMode();
    const status = g.registerNode({ name: 'status', type: 'signal' });
    let statusValue = 'idle';
    g.setNodeValue(status, () => statusValue);
    g.setNodeSetter(status, (next: string) => {
      statusValue = next;
    });

    const op = g.beginOperation('loadUser', { outcomes: ['resolved', 'rejected'] });
    g.resolveOperation(op, { id: 1 });

    await g.withOperation(op, async () => {
      await Promise.resolve();
      g.driveNodeValue(status, 'ready');
    });

    const span = g.getOperations()[0];
    expect(span.events.some(e => e.type === 'signal-change' && e.operationId === op)).toBe(true);
    expect(g.currentOperationId()).toBeUndefined();
    expect(g.getNodeLastSetContext(status)).toBe('async');
  });

  it('records operation outcome coverage through graph lifecycle APIs', () => {
    const g = new CircuitGraph();
    coverage.reset();
    g.enableCoverage();

    const op = g.beginOperation('save', { outcomes: ['resolved', 'rejected', 'timeout'] });
    g.resolveOperation(op, { ok: true });

    const report = coverage.getReport();
    expect(report.operations[0].operationName).toBe('save');
    expect(report.operations[0].observedOutcomes.get('resolved')).toBe(1);
    expect(report.gaps).toContainEqual({
      kind: 'operation',
      id: 'save',
      missing: ['rejected', 'timeout'],
    });
    g.disableCoverage();
    coverage.reset();
  });

  it('registers operation models for deterministic outcome exploration', () => {
    const g = new CircuitGraph();
    const outputId = g.registerNode({ name: 'result', type: 'signal' });
    const modelId = g.registerOperationModel({
      name: 'loadUser',
      outcomes: ['resolved', 'rejected', 'timeout'],
      outputDeps: [outputId],
      metadata: { route: '/user' },
      handleOutcome: (outcome, context) => {
        expect(context.operationId).toMatch(/^loadUser_/);
        expect(context.model.name).toBe('loadUser');
        expect(outcome).toBe('resolved');
      },
    });

    const [model] = g.getOperationModels();
    expect(model.id).toBe(modelId);
    expect(model.outcomes).toEqual(['resolved', 'rejected', 'timeout']);
    expect(model.outputDeps).toEqual([outputId]);

    const snap = g.snapshot();
    expect(snap.operationModels?.[0]).toMatchObject({
      id: modelId,
      name: 'loadUser',
      outcomes: ['resolved', 'rejected', 'timeout'],
      outputDeps: [outputId],
      metadata: { route: '/user' },
    });
    expect(snap.operationModels?.[0].metadata).not.toHaveProperty('handleOutcome');
  });

  it('assertOperationStatus fails on disallowed operation outcomes', () => {
    const g = new CircuitGraph();
    const assertionId = assertOperationStatus('save', ['resolved'], 'save-resolves', g);
    const op = g.beginOperation('save');
    g.rejectOperation(op, new Error('boom'));

    const violations = g.checkAssertions();

    expect(violations).toHaveLength(1);
    expect(violations[0].nodeId).toBe(assertionId);
    expect(g.getAssertions()[0].metadata?.operationDomains?.save).toEqual(['resolved']);
    expect(g.getAssertions()[0].metadata?.partial).toBe(false);
  });

  it('assertNoStaleOperations fails when a tracked operation is marked stale', () => {
    const g = new CircuitGraph();
    const assertionId = assertNoStaleOperations('loadUser', 'loadUser-not-stale', g);
    const first = g.beginOperation('loadUser');
    const second = g.beginOperation('loadUser');
    g.markOperationStale(first, second);

    const violations = g.checkAssertions();

    expect(violations).toHaveLength(1);
    expect(violations[0].nodeId).toBe(assertionId);
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

  it('classifies unconstrained numeric changes as activity instead of transition coverage', () => {
    const g = new CircuitGraph();
    coverage.reset();
    g.enableCoverage();
    const tick = g.registerNode({ name: 'tick', type: 'signal' });

    g.notifyChange(tick, 0, 1);
    g.notifyChange(tick, 1, 2);

    const report = coverage.getReport();
    expect(report.transitions).toHaveLength(0);
    expect(report.numericActivity[0]).toMatchObject({
      signalId: tick,
      samples: 2,
      min: 0,
      max: 2,
    });
    expect(report.summary.totalPoints).toBe(0);
    g.disableCoverage();
    coverage.reset();
  });

  it('records numeric transitions when a numeric node declares finite states', () => {
    const g = new CircuitGraph();
    coverage.reset();
    g.enableCoverage();
    const mode = g.registerNode({
      name: 'numericMode',
      type: 'signal',
      metadata: { states: [0, 1] },
    });

    g.notifyChange(mode, 0, 1);

    const report = coverage.getReport();
    expect(report.transitions[0].fsmId).toBe(mode);
    expect(report.transitions[0].transitions.get('0->1')).toBe(1);
    expect(report.numericActivity).toHaveLength(0);
    g.disableCoverage();
    coverage.reset();
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

  // --- Batch API ---

  it('beginBatch/endBatch correctly scopes a tick', () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });

    g.beginBatch();
    g.notifyChange(a, 0, 1);
    expect(g.currentTick).toBe(0);
    g.endBatch();
    expect(g.currentTick).toBe(1);
  });

  it('nested batches use depth counting', () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });

    g.beginBatch();
    g.beginBatch();
    g.notifyChange(a, 0, 1);
    g.endBatch();
    expect(g.currentTick).toBe(0);
    g.endBatch();
    expect(g.currentTick).toBe(1);
  });

  it('multiple signal changes within a batch share the same tick', () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    const b = g.registerNode({ name: 'b', type: 'signal' });

    g.beginBatch();
    g.notifyChange(a, 0, 1);
    g.notifyChange(b, 'x', 'y');
    g.endBatch();

    expect(g.currentTick).toBe(1);
    const events = g.getRecentEvents(2);
    expect(events[0].tick).toBe(0);
    expect(events[1].tick).toBe(0);
  });

  it('microtask fallback still works when no batch is active', async () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });

    g.notifyChange(a, 0, 1);
    expect(g.isInBatch()).toBe(false);
    expect(g.currentTick).toBe(0);

    await g.flushTick();
    expect(g.currentTick).toBe(1);
  });

  it('isInBatch reflects batch state', () => {
    const g = new CircuitGraph();
    expect(g.isInBatch()).toBe(false);
    g.beginBatch();
    expect(g.isInBatch()).toBe(true);
    g.endBatch();
    expect(g.isInBatch()).toBe(false);
  });

  it('batch state is recoverable after driveNodeValue throws', () => {
    const g = new CircuitGraph();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    g.setNodeValue(a, () => 0);
    g.setNodeSetter(a, () => { throw new Error('boom'); });

    g.beginBatch();
    expect(() => g.driveNodeValue(a, 1)).toThrow('boom');
    expect(g.isInBatch()).toBe(true);
    g.endBatch();
    expect(g.isInBatch()).toBe(false);
    expect(g.currentTick).toBe(1);
  });

  // --- Cycle detection ---

  it('detects cycles in derived nodes and emits warning via onCycleDetected', () => {
    const g = new CircuitGraph();
    g.enterTestMode();

    const a = g.registerNode({ name: 'a', type: 'derived' });
    const b = g.registerNode({ name: 'b', type: 'derived' });
    g.addEdge(a, b);
    g.addEdge(b, a);

    const cycles: string[][] = [];
    g.onCycleDetected(nodeIds => cycles.push(nodeIds));

    g.openTick();
    g.propagate();
    g.closeTick();

    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toContain(a);
    expect(cycles[0]).toContain(b);
  });

  it('onCycleDetected listener can be unsubscribed', () => {
    const g = new CircuitGraph();
    g.enterTestMode();

    const a = g.registerNode({ name: 'a', type: 'derived' });
    const b = g.registerNode({ name: 'b', type: 'derived' });
    g.addEdge(a, b);
    g.addEdge(b, a);

    const cycles: string[][] = [];
    const unsub = g.onCycleDetected(nodeIds => cycles.push(nodeIds));
    unsub();

    g.openTick();
    g.propagate();
    g.closeTick();

    expect(cycles).toHaveLength(0);
  });

  it('topological sort still appends cycle members so behavior is preserved', () => {
    const g = new CircuitGraph();
    g.enterTestMode();

    let aVal = 1;
    const a = g.registerNode({
      name: 'a',
      type: 'derived',
      computeFn: () => aVal + 1,
    });
    const b = g.registerNode({
      name: 'b',
      type: 'derived',
      computeFn: () => 42,
    });
    g.addEdge(a, b);
    g.addEdge(b, a);

    g.openTick();
    g.propagate();
    g.closeTick();

    expect(g.getNode(b)?.getValue?.()).toBe(42);
  });

  // --- Re-entrancy guard ---

  it('re-entrant driveNodeValue does not corrupt state', () => {
    const g = new CircuitGraph();
    g.enterTestMode();

    let aVal = 0;
    let bVal = 0;
    const a = g.registerNode({ name: 'a', type: 'signal' });
    g.setNodeValue(a, () => aVal);
    g.setNodeSetter(a, (v: number) => { aVal = v; });

    const b = g.registerNode({ name: 'b', type: 'signal' });
    g.setNodeValue(b, () => bVal);
    g.setNodeSetter(b, (v: number) => { bVal = v; });

    const derived = g.registerNode({
      name: 'sum',
      type: 'derived',
      deps: [a, b],
      computeFn: () => {
        // Re-entrant: driving b from within a's propagation
        if (aVal === 1 && bVal === 0) {
          g.driveNodeValue(b, 10);
        }
        return aVal + bVal;
      },
    });

    g.openTick();
    g.driveNodeValue(a, 1);
    g.closeTick();

    expect(aVal).toBe(1);
    expect(bVal).toBe(10);
    expect(g.getNode(derived)?.getValue?.()).toBe(11);
  });

  // --- Buffer stats ---

  it('getBufferStats returns correct values before overflow', () => {
    const g = new CircuitGraph({ eventBufferSize: 8 });
    g.enterTestMode();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    // registerNode emits 1 event (node-created)
    const stats = g.getBufferStats();
    expect(stats.capacity).toBe(8);
    expect(stats.used).toBe(1);
    expect(stats.overflowCount).toBe(0);
  });

  it('getBufferStats overflow count increments correctly', () => {
    const g = new CircuitGraph({ eventBufferSize: 4 });
    g.enterTestMode();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    // 1 event from registerNode, push 5 more to overflow a size-4 buffer
    for (let i = 0; i < 5; i++) {
      g.notifyChange(a, i, i + 1);
    }
    const stats = g.getBufferStats();
    expect(stats.capacity).toBe(4);
    expect(stats.used).toBe(4);
    expect(stats.overflowCount).toBe(2);
  });

  it('custom buffer size works', () => {
    const g = new CircuitGraph({ eventBufferSize: 16 });
    expect(g.getBufferStats().capacity).toBe(16);
  });

  it('default buffer size is 256', () => {
    const g = new CircuitGraph();
    expect(g.getBufferStats().capacity).toBe(256);
  });

  it('reset clears overflow count', () => {
    const g = new CircuitGraph({ eventBufferSize: 4 });
    g.enterTestMode();
    const a = g.registerNode({ name: 'a', type: 'signal' });
    for (let i = 0; i < 10; i++) {
      g.notifyChange(a, i, i + 1);
    }
    expect(g.getBufferStats().overflowCount).toBeGreaterThan(0);
    g.reset();
    expect(g.getBufferStats().overflowCount).toBe(0);
  });

  it('enterSandbox shadows signal values and exitSandbox restores them', () => {
    const g = new CircuitGraph();
    let realValue = 'original';
    const id = g.registerNode({ name: 'sig', type: 'signal' });
    g.setNodeValue(id, () => realValue);
    g.setNodeSetter(id, (v: any) => { realValue = v; });

    expect(g.getNode(id)!.getValue!()).toBe('original');

    g.enterSandbox();
    expect(g.isInSandbox()).toBe(true);

    // Drive a value in sandbox — should NOT affect real value
    g.driveNodeValue(id, 'sandboxed');
    expect(g.getNode(id)!.getValue!()).toBe('sandboxed');
    expect(realValue).toBe('original'); // Real value untouched

    g.exitSandbox();
    expect(g.isInSandbox()).toBe(false);

    // Original getter/setter restored
    expect(g.getNode(id)!.getValue!()).toBe('original');
    g.getNode(id)!.setValue!('updated');
    expect(realValue).toBe('updated');
  });

  it('sandbox supports function updaters without affecting the real value', () => {
    const g = new CircuitGraph();
    let realValue = 10;
    const id = g.registerNode({ name: 'count', type: 'signal' });
    g.setNodeValue(id, () => realValue);
    g.setNodeSetter(id, (v: any) => { realValue = v; });

    g.enterSandbox();
    g.driveNodeValue(id, (prev: number) => prev + 5);
    expect(g.getNode(id)!.getValue!()).toBe(15);
    expect(realValue).toBe(10);

    g.exitSandbox();
    expect(g.getNode(id)!.getValue!()).toBe(10);
  });

  it('sandbox mode uses test mode ticks', () => {
    const g = new CircuitGraph();
    const id = g.registerNode({ name: 'sig', type: 'signal' });
    let realValue = 0;
    g.setNodeValue(id, () => realValue);
    g.setNodeSetter(id, (v: any) => { realValue = v; });

    g.enterSandbox();

    // In sandbox (which enables test mode), ticks should not auto-close
    g.openTick();
    g.driveNodeValue(id, 1);
    expect(g.currentTick).toBe(0); // tick not auto-closed
    g.closeTick();
    expect(g.currentTick).toBe(1);

    g.exitSandbox();
  });

  it('reset clears sandbox state', () => {
    const g = new CircuitGraph();
    const id = g.registerNode({ name: 'sig', type: 'signal' });
    g.setNodeValue(id, () => 'val');
    g.setNodeSetter(id, () => {});

    g.enterSandbox();
    expect(g.isInSandbox()).toBe(true);
    g.reset();
    expect(g.isInSandbox()).toBe(false);
  });
});
