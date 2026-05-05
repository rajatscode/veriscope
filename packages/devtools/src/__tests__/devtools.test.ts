// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitGraph, coverage } from '@veriscope/graph';
import { mountDevtools } from '../index';
import type { AutotestResult, MutateResult } from '../index';

const canvasText: string[] = [];
const canvasOps: Array<{ op: string; args: unknown[] }> = [];

function metric(covered: number, total: number) {
  return {
    covered,
    total,
    percentage: total > 0 ? (covered / total) * 100 : 0,
  };
}

function autotestResult(assertionId = 'assertion_0'): AutotestResult {
  return {
    status: 'passed',
    assertions: [{
      id: assertionId,
      name: 'invariant',
      kind: 'always',
      status: 'passed',
      partialCoverage: false,
      exercised: true,
      scenarioCount: 1,
      passScenarioCount: 1,
      failScenarioCount: 0,
    }],
    violations: [],
    scenarios: [{
      id: 'scenario-1',
      kind: 'enumerated',
      tick: 0,
      steps: [],
      assertions: ['invariant'],
      violations: [],
    }],
    coverage: {
      toggle: metric(2, 2),
      transitions: metric(0, 0),
      cross: metric(0, 0),
      operations: metric(0, 0),
      overall: metric(2, 2),
      gaps: [],
    },
    steps: 1,
  };
}

function operationAutotestResult(): AutotestResult {
  return {
    ...autotestResult('operation-assertion-id'),
    scenarios: [{
      id: 'operation-scenario-1',
      kind: 'operation-outcome',
      tick: 2,
      steps: [{ signal: 'operation:submit', value: 'resolved' }],
      assertions: ['operation-visible'],
      violations: [],
      observations: [
        {
          type: 'operation-begin',
          node: 'operation:submit_0',
          operationId: 'submit_0',
          operationName: 'submit',
          status: 'pending',
        },
        {
          type: 'operation-resolve',
          node: 'operation:submit_0',
          operationId: 'submit_0',
          operationName: 'submit',
          status: 'resolved',
        },
        {
          type: 'signal-change',
          node: 'submit.status',
          oldValue: 'pending',
          newValue: 'ok',
          operationId: 'submit_0',
          operationName: 'submit',
        },
      ],
    }],
    coverage: {
      toggle: metric(0, 0),
      transitions: metric(0, 0),
      cross: metric(0, 0),
      operations: metric(1, 1),
      overall: metric(1, 1),
      gaps: [],
    },
    plan: {
      deterministic: true,
      budget: 1000,
      exhausted: true,
      stoppedByBudget: false,
      generatedCases: 1,
      hiddenDuplicateCases: 0,
      generatedReachableCoverage: metric(1, 1),
      phaseCounts: {
        enumerated: 0,
        'current-state': 0,
        sequence: 0,
        'operation-outcome': 1,
        'coverage-directed': 0,
        'coverage-completion': 0,
        adversarial: 0,
      },
    },
    steps: 2,
  };
}

function mutationResult(): MutateResult {
  return {
    total: 2,
    killed: 1,
    killedMutations: [{
      mutation: 'negate:canSubmit',
      description: 'Negate canSubmit',
      scenarioId: 'scenario-1',
      assertionName: 'invariant',
    }],
    survived: [{ mutation: 'swap-edge:a:b', description: 'Swap edge a/b' }],
    invalid: [],
    equivalent: [],
    score: 50,
    budgetPerMutation: 1000,
    autotestRuns: 2,
    autotestSteps: 73,
  };
}

function mutationResultWithSkipped(): MutateResult {
  return {
    ...mutationResult(),
    generatedMutants: 6,
    skipped: [
      {
        mutation: 'sever-edge:input->view',
        description: 'Sever dependency from input to view',
        reason: 'available in broad mutation mode; excluded from the default semantic score',
      },
      {
        mutation: 'swap-edge:input<->clock',
        description: 'Swap signal input to read clock value',
        reason: 'available in broad mutation mode; excluded from the default semantic score',
      },
      {
        mutation: 'remove-assertion:invariant',
        description: 'Remove assertion invariant',
        reason: 'meta-mutations are disabled',
      },
    ],
  };
}

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find(el => el.textContent === text);
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}

beforeEach(() => {
  document.body.innerHTML = '';
  canvasText.length = 0;
  canvasOps.length = 0;
  coverage.reset();

  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return 800; },
  });

  const storage = new Map<string, string>();
  const localStorageStub: Storage = {
    get length() { return storage.size; },
    clear: vi.fn(() => storage.clear()),
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    key: vi.fn((index: number) => [...storage.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => { storage.delete(key); }),
    setItem: vi.fn((key: string, value: string) => { storage.set(key, String(value)); }),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: localStorageStub, configurable: true });
  Object.defineProperty(window, 'localStorage', { value: localStorageStub, configurable: true });

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());

  const ctx = new Proxy(
    {
      fillText: vi.fn((text: unknown) => {
        canvasText.push(String(text));
      }),
      moveTo: vi.fn((...args: unknown[]) => {
        canvasOps.push({ op: 'moveTo', args });
      }),
      lineTo: vi.fn((...args: unknown[]) => {
        canvasOps.push({ op: 'lineTo', args });
      }),
      measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop as keyof typeof target];
        return vi.fn();
      },
      set(target, prop, value) {
        (target as Record<PropertyKey, unknown>)[prop] = value;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
});

describe('mountDevtools', () => {
  it('mounts the product tabs and redraws Circuit on graph events', () => {
    const graph = new CircuitGraph();
    graph.registerNode({ name: 'first', type: 'signal' });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'circuit' });

    expect(host.textContent).toContain('Circuit');
    expect(host.textContent).toContain('Waveform');
    expect(host.textContent).toContain('Live Assertions');
    expect(host.textContent).toContain('Autotest');
    expect(host.textContent).toContain('Mutants');
    expect(canvasText).toContain('first');

    canvasText.length = 0;
    graph.registerNode({ name: 'second', type: 'derived', deps: [] });
    expect(canvasText).toContain('second');

    handle.dispose();
  });

  it('shows recent Circuit graph activity from signal and derived events', () => {
    const graph = new CircuitGraph();
    let ready = false;
    const readyId = graph.registerNode({ name: 'ready', type: 'signal' });
    graph.setNodeValue(readyId, () => ready);
    graph.setNodeSetter(readyId, value => {
      ready = value;
    });
    graph.registerNode({
      name: 'canStart',
      type: 'derived',
      deps: [readyId],
      computeFn: () => ready,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'circuit' });

    expect(host.textContent).toContain('Live tick 0 · idle');

    graph.driveNodeValue(readyId, true);
    handle.refresh();

    expect(host.textContent).toContain('derived-recompute · canStart');
    expect(host.textContent).toContain('active nodes');
    expect(host.textContent).toContain('active edges');

    handle.dispose();
  });

  it('keeps Circuit flow selection active while live graph events update', () => {
    const graph = new CircuitGraph();
    let ready = false;
    const readyId = graph.registerNode({ name: 'ready', type: 'signal' });
    graph.setNodeValue(readyId, () => ready);
    graph.setNodeSetter(readyId, value => {
      ready = value;
    });
    const canStartId = graph.registerNode({
      name: 'canStart',
      type: 'derived',
      deps: [readyId],
      computeFn: () => ready,
    });
    const assertId = graph.registerNode({ name: 'can-start-observed', type: 'assertion', deps: [canStartId] });
    graph.setAssertionFn(assertId, () => true, 'always');

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'circuit' });
    const canvas = host.querySelector('canvas')!;

    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 }));
    handle.refresh();

    expect(host.textContent).toContain('Selected ready: 0 upstream, 2 downstream');

    graph.driveNodeValue(readyId, true);
    handle.refresh();

    expect(host.textContent).toContain('derived-recompute · canStart');
    expect(host.textContent).toContain('Selected ready: 0 upstream, 2 downstream');

    handle.dispose();
  });

  it('does not redraw hidden Circuit work until the tab is active again', () => {
    const graph = new CircuitGraph();
    graph.registerNode({ name: 'first', type: 'signal' });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'circuit' });

    canvasText.length = 0;
    handle.setTab('autotest');
    graph.registerNode({ name: 'hidden-while-autotest', type: 'signal' });
    expect(canvasText).not.toContain('hidden-while-autotest');

    handle.setTab('circuit');
    expect(canvasText).toContain('hidden-while-autotest');

    handle.dispose();
  });

  it('groups repeated player metric nodes in large Circuit graphs', () => {
    const graph = new CircuitGraph();
    const root = graph.registerNode({ name: 'arena.players', type: 'signal' });
    const metrics = ['score', 'lines', 'pendingGarbage', 'lastSent', 'lastReceived', 'stackHeight', 'alive', 'ko', 'piece'];

    for (let player = 1; player <= 10; player++) {
      for (const metric of metrics) {
        const nodeId = graph.registerNode({
          name: `p${player}.${metric}`,
          type: 'derived',
          deps: [root],
        });
        graph.setNodeValue(nodeId, () => metric === 'piece' ? 'I' : metric === 'ko' ? false : 0);
      }
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'circuit' });

    expect(canvasText).toContain('p1.metrics');
    expect(canvasText).not.toContain('p1.score');
    expect(host.textContent).toContain('Grouped 90 repeated player metric nodes');

    handle.dispose();
  });

  it('records waveform data and lets users toggle signal visibility', () => {
    const graph = new CircuitGraph();
    let ready = false;
    const readyId = graph.registerNode({ name: 'player.ready', type: 'signal' });
    graph.setNodeValue(readyId, () => ready);
    graph.setNodeSetter(readyId, value => {
      ready = value;
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'waveform' });

    graph.driveNodeValue(readyId, true);
    expect(graph.getWaveformData().get(readyId)?.map(point => point.v)).toEqual([false, true]);

    const name = [...host.querySelectorAll('span')].find(el => el.textContent === 'ready');
    expect(name).toBeDefined();
    const row = name!.parentElement!;
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const updatedName = [...host.querySelectorAll('span')].find(el => el.textContent === 'ready');
    expect(updatedName!.parentElement!.style.opacity).toBe('0.35');

    handle.dispose();
  });

  it('records propagated derived values in waveform data', () => {
    const graph = new CircuitGraph();
    let ready = false;
    const readyId = graph.registerNode({ name: 'player.ready', type: 'signal' });
    graph.setNodeValue(readyId, () => ready);
    graph.setNodeSetter(readyId, value => {
      ready = value;
    });
    const canStartId = graph.registerNode({
      name: 'player.canStart',
      type: 'derived',
      deps: [readyId],
      computeFn: () => ready,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'waveform' });

    graph.driveNodeValue(readyId, true);

    expect(graph.getWaveformData().get(canStartId)?.map(point => point.v)).toEqual([false, true]);

    handle.dispose();
  });

  it('renders sparse numeric waveforms as held steps capped at the last graph event', () => {
    let now = 1000;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const graph = new CircuitGraph();
    let stackHeight = 0;
    let clock = false;
    const stackId = graph.registerNode({ name: 'p1.stackHeight', type: 'signal' });
    graph.setNodeValue(stackId, () => stackHeight);
    graph.setNodeSetter(stackId, value => {
      stackHeight = value;
    });
    const clockId = graph.registerNode({ name: 'arena.tickPulse', type: 'signal' });
    graph.setNodeValue(clockId, () => clock);
    graph.setNodeSetter(clockId, value => {
      clock = value;
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'waveform' });

    const clockName = [...host.querySelectorAll('span')].find(el => el.textContent === 'tickPulse');
    expect(clockName).toBeDefined();
    clockName!.parentElement!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    canvasOps.length = 0;
    now = 1100;
    graph.driveNodeValue(stackId, 4);
    now = 1200;
    graph.driveNodeValue(clockId, true);
    handle.refresh();

    const plotLines = canvasOps
      .filter(op => op.op === 'lineTo')
      .map(op => ({ x: Number(op.args[0]), y: Number(op.args[1]) }))
      .filter(point => point.x >= 120 && point.y >= 0 && point.y <= 50);

    expect(plotLines.some((point, index) => {
      const previous = plotLines[index - 1];
      return previous && point.x > previous.x && Object.is(point.y, previous.y);
    })).toBe(true);
    expect(Math.max(...plotLines.map(point => point.x))).toBeLessThan(300);

    nowSpy.mockRestore();
    handle.dispose();
  });

  it('runs the package autotest callback and renders coverage results', async () => {
    const graph = new CircuitGraph();
    const assertionId = graph.registerNode({ name: 'invariant', type: 'assertion' });
    graph.setAssertionFn(assertionId, () => true, 'always');
    const autotest = vi.fn(async () => autotestResult('factory-assertion-id'));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'autotest', autotest, coverage });

    buttonByText(host, 'Run Autotest').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(autotest).toHaveBeenCalledWith(graph, expect.objectContaining({ name: 'devtools-autotest' }));
    expect(host.textContent).toContain('Autotest Results');
    expect(host.textContent).toContain('Generated reachable coverage: 100.0% (2/2)');
    expect(host.textContent).toContain('@veriscope/test runAutotest generated these cases from the graph and assertion metadata.');
    expect(host.textContent).toContain('Assertion Results (1 passed, 0 failed)');
    expect(host.textContent).toContain('Generated Cases (1 passed, 0 failed)');
    expect(host.textContent).toContain('Passing Cases (1)');
    expect(host.textContent).toContain('Failing Cases (0)');
    expect(host.textContent).toContain('scenario-1');
    expect(host.textContent).toContain('1 passed');
    expect(host.textContent).not.toContain('Operations');

    handle.dispose();
  });

  it('keeps live assertion checks out of the Autotest tab', async () => {
    const graph = new CircuitGraph();
    const assertionId = graph.registerNode({ name: 'live-only', type: 'assertion' });
    graph.setAssertionFn(assertionId, () => true, 'always');
    const operationId = graph.beginOperation('loadUser', { outcomes: ['resolved', 'rejected'] });
    graph.resolveOperation(operationId, { id: 1 });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'live-assertions', coverage });

    buttonByText(host, 'Check Live').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(host.textContent).toContain('Live Assertions');
    expect(host.textContent).toContain('live-only');
    expect(host.textContent).toContain('P:1 F:0');
    expect(host.textContent).toContain('Operations (1)');
    expect(host.textContent).toContain('loadUser');

    handle.setTab('autotest');

    const autotestEmpty = [...host.querySelectorAll<HTMLElement>('div')]
      .find(el => el.textContent === 'No autotest runner registered.');
    expect(autotestEmpty).toBeDefined();
    const autotestText = autotestEmpty!.parentElement!.textContent ?? '';
    expect(autotestText).toContain('No autotest runner registered.');
    expect(autotestText).not.toContain('P:1 F:0');
    expect(autotestText).not.toContain('Operations (1)');

    handle.dispose();
  });

  it('renders operation outcome cases and operation observations in Autotest', async () => {
    const graph = new CircuitGraph();
    const autotest = vi.fn(async () => operationAutotestResult());

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'autotest', autotest, coverage });

    buttonByText(host, 'Run Autotest').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(host.textContent).toContain('operation-outcome 1');
    expect(host.textContent).toContain('operation:submit=\"resolved\"');
    expect(host.textContent).toContain('operation events: submit:pending, submit:resolved');
    expect(host.textContent).toContain('Runtime counters: toggles 0/0, transitions 0/0, cross 0/0, operations 1/1');

    handle.dispose();
  });

  it('explains runtime coverage and shows concrete missing points', () => {
    const graph = new CircuitGraph();
    graph.enableCoverage();
    let ready = false;
    const readyId = graph.registerNode({ name: 'player.ready', type: 'signal' });
    graph.setNodeValue(readyId, () => ready);
    graph.setNodeSetter(readyId, value => {
      ready = value;
    });
    graph.driveNodeValue(readyId, true);
    const assertionId = graph.registerNode({ name: 'ready-visible', type: 'assertion' });
    graph.setAssertionFn(assertionId, () => ready, 'always');

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'live-assertions', coverage });

    expect(host.textContent).toContain('Runtime Coverage (live graph activity)');
    expect(host.textContent).toContain('Counts observed boolean signal values');
    expect(host.textContent).toContain('not assertion, line, branch, or autotest coverage');
    expect(host.textContent).toContain('Overall: 2/4 (50.0%)');
    expect(host.textContent).toContain('Toggles: 1/2 (50.0%)');
    expect(host.textContent).toContain('Missing toggle: player.ready=false');
    expect(host.textContent).toContain('Missing transition: player.ready -> true->false');

    graph.disableCoverage();
    handle.dispose();
  });

  it('renders passing and failing autotest assertions and generated cases separately', async () => {
    const graph = new CircuitGraph();
    const passId = graph.registerNode({ name: 'passes', type: 'assertion' });
    const failId = graph.registerNode({ name: 'fails', type: 'assertion' });
    graph.setAssertionFn(passId, () => true, 'always');
    graph.setAssertionFn(failId, () => false, 'always');
    const autotest = vi.fn(async (): Promise<AutotestResult> => ({
      status: 'failed',
      assertions: [
        { id: 'factory-pass', name: 'passes', kind: 'always', status: 'passed', partialCoverage: false, exercised: true, scenarioCount: 1, passScenarioCount: 1, failScenarioCount: 0 },
        { id: 'factory-fail', name: 'fails', kind: 'after', status: 'failed', partialCoverage: true, reason: 'expected test failure', exercised: true, scenarioCount: 1, passScenarioCount: 0, failScenarioCount: 1 },
        { id: 'factory-fail-late', name: 'fails-late', kind: 'always', status: 'failed', partialCoverage: false, exercised: true, scenarioCount: 1, passScenarioCount: 0, failScenarioCount: 1 },
      ],
      violations: [{
        assertionName: 'fails',
        tick: 2,
        signalValues: { mode: 'bad' },
        sequence: [{ signal: 'mode', value: 'bad' }],
      }],
      scenarios: [
        {
          id: 'case-pass',
          kind: 'enumerated',
          tick: 1,
          steps: [{ signal: 'mode', value: 'ok' }],
          assertions: ['passes'],
          violations: [],
          observations: [{ type: 'derived-recompute', node: 'canSubmit', oldValue: false, newValue: true }],
        },
        {
          id: 'case-fail',
          kind: 'adversarial',
          tick: 2,
          steps: [{ signal: 'mode', value: 'bad' }],
          assertions: ['fails', 'fails-late'],
          violations: ['fails', 'fails-late'],
          observations: [
            { type: 'assertion-armed', node: 'fails' },
            { type: 'assertion-failed', node: 'fails' },
          ],
        },
      ],
      coverage: {
        toggle: metric(1, 2),
        transitions: metric(1, 2),
        cross: metric(0, 0),
        operations: metric(0, 0),
        overall: metric(1, 2),
        gaps: [{ kind: 'toggle', id: 'mode', missing: ['false'] }],
      },
      steps: 2,
    }));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'autotest', autotest, coverage });

    buttonByText(host, 'Run Autotest').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(host.textContent).toContain('Assertion Results (1 passed, 2 failed)');
    expect(host.textContent).toContain('passes');
    expect(host.textContent).toContain('passed');
    expect(host.textContent).toContain('fails');
    expect(host.textContent).toContain('failed · partial');
    expect(host.textContent).toContain('after · 1 cases');
    expect(host.textContent).toContain('Generated Cases (1 passed, 1 failed)');
    expect(host.textContent).toContain('Evidence Cases (2)');
    expect(host.textContent).toContain('Passing Cases (1)');
    expect(host.textContent).toContain('case-pass');
    expect(host.textContent).toContain('Failing Cases (1)');
    expect(host.textContent).toContain('case-fail');
    expect(host.textContent).toContain('failed: fails, fails-late');
    expect(host.textContent).toContain('failed assertions: fails, fails-late');
    expect(host.textContent).toContain('Runtime counters: toggles 1/2, transitions 1/2');
    expect(host.textContent).toContain('Runtime counter gaps: toggle:mode missing false');
    expect(host.textContent).toContain('propagated: canSubmit false -> true');
    expect(host.textContent).toContain('assertion events: armed:fails, failed:fails');

    handle.dispose();
  });

  it('shows in-flight autotest runs and preserves the prior result during rerun', async () => {
    const graph = new CircuitGraph();
    let resolveFirst: ((value: AutotestResult) => void) | undefined;
    let resolveSecond: ((value: AutotestResult) => void) | undefined;
    const autotest = vi
      .fn()
      .mockImplementationOnce(() => new Promise<AutotestResult>(resolve => {
        resolveFirst = resolve;
      }))
      .mockImplementationOnce(() => new Promise<AutotestResult>(resolve => {
        resolveSecond = resolve;
      }));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'autotest', autotest, coverage });

    buttonByText(host, 'Run Autotest').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(host.textContent).toContain('Autotest run #1 running');
    expect(host.textContent).toContain('Generating cases from graph/assertion metadata');

    await flushPromises();
    expect(autotest).toHaveBeenCalledTimes(1);
    resolveFirst?.(autotestResult());
    await flushPromises();
    expect(host.textContent).toContain('Last autotest run: #1 completed');
    expect(host.textContent).toContain('Generated cases: 1');
    expect(host.textContent).toContain('Autotest Results');

    buttonByText(host, 'Run Autotest').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(host.textContent).toContain('Autotest run #2 running');
    expect(host.textContent).toContain('Showing the previous completed result until this run finishes.');
    expect(host.textContent).toContain('Autotest Results');

    await flushPromises();
    expect(autotest).toHaveBeenCalledTimes(2);
    resolveSecond?.(autotestResult());
    await flushPromises();
    expect(host.textContent).toContain('Last autotest run: #2 completed');

    handle.dispose();
  });

  it('runs mutation callbacks and renders killed and surviving mutants', async () => {
    const graph = new CircuitGraph();
    const mutate = vi.fn(async () => mutationResult());

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'mutants', mutate });

    buttonByText(host, 'Run Semantic Mutants').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'semantic' }));
    expect(host.textContent).toContain('Score: 50.0%');
    expect(host.textContent).toContain('Last run: #1 completed');
    expect(host.textContent).toContain('Generated mutants: 2');
    expect(host.textContent).toContain('Seed: deterministic/no seed reported');
    expect(host.textContent).toContain('Budget per mutant: 1000');
    expect(host.textContent).toContain('Autotest runs: 2');
    expect(host.textContent).toContain('Autotest steps: 73');
    expect(host.textContent).toContain('Rerun Semantic Mutants');
    expect(host.textContent).toContain('Semantic mode scores assertion-reachable behavior mutants.');
    expect(host.textContent).toContain('negate:canSubmit');
    expect(host.textContent).toContain('swap-edge:a:b');

    handle.dispose();
  });

  it('passes broad mutation mode from the panel toggle', async () => {
    const graph = new CircuitGraph();
    const mutate = vi.fn(async () => mutationResult());

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'mutants', mutate });

    expect(host.textContent).toContain('Mutation mode');
    buttonByText(host, 'Broad Sweep').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    buttonByText(host, 'Run Broad Mutants').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'broad' }));
    expect(host.textContent).toContain('Broad mode includes structural and effect candidates');

    handle.dispose();
  });

  it('keeps skipped mutation candidates inspectable across refreshes', async () => {
    const graph = new CircuitGraph();
    const mutate = vi.fn(async () => mutationResultWithSkipped());

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'mutants', mutate });

    buttonByText(host, 'Run Semantic Mutants').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(host.textContent).toContain('Skipped candidates (3)');
    expect(host.textContent).toContain('Switch to Broad Sweep');
    expect(host.textContent).toContain('available in broad mutation mode; excluded from the default semantic score · 2');

    buttonByText(host, 'Inspect').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(host.textContent).toContain('sever-edge:input->view');
    expect(host.textContent).toContain('swap-edge:input<->clock');

    handle.refresh();
    expect(host.textContent).toContain('Collapse');
    expect(host.textContent).toContain('swap-edge:input<->clock');

    buttonByText(host, 'Hide').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(host.textContent).not.toContain('Switch to Broad Sweep');
    handle.refresh();
    expect(host.textContent).toContain('Skipped candidates (3)');
    expect(host.textContent).not.toContain('Switch to Broad Sweep');

    handle.dispose();
  });

  it('shows in-flight mutation runs and preserves the prior result during rerun', async () => {
    const graph = new CircuitGraph();
    let resolveFirst: ((value: MutateResult) => void) | undefined;
    let resolveSecond: ((value: MutateResult) => void) | undefined;
    const mutate = vi
      .fn()
      .mockImplementationOnce(() => new Promise<MutateResult>(resolve => {
        resolveFirst = resolve;
      }))
      .mockImplementationOnce(() => new Promise<MutateResult>(resolve => {
        resolveSecond = resolve;
      }));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'mutants', mutate });

    buttonByText(host, 'Run Semantic Mutants').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(host.textContent).toContain('Run #1 running');
    expect(host.textContent).toContain('Elapsed:');
    expect(host.textContent).toContain('Applying generated mutations and running the full autotest budget against each mutant.');

    await flushPromises();
    expect(mutate).toHaveBeenCalledTimes(1);
    resolveFirst?.(mutationResult());
    await flushPromises();
    expect(host.textContent).toContain('Last run: #1 completed');
    expect(host.textContent).toContain('Score: 50.0%');

    buttonByText(host, 'Rerun Semantic Mutants').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(host.textContent).toContain('Run #2 running');
    expect(host.textContent).toContain('Elapsed:');
    expect(host.textContent).toContain('Showing the previous completed result until this run finishes.');
    expect(host.textContent).toContain('Score: 50.0%');

    await flushPromises();
    expect(mutate).toHaveBeenCalledTimes(2);
    resolveSecond?.({ ...mutationResult(), seed: 'fuzz-seed-1' });
    await flushPromises();
    expect(host.textContent).toContain('Last run: #2 completed');
    expect(host.textContent).toContain('Seed: fuzz-seed-1');

    handle.dispose();
  });

  it('renders live mutation progress from the runner callback', async () => {
    const graph = new CircuitGraph();
    let resolveRun: ((value: MutateResult) => void) | undefined;
    const mutate = vi.fn(async (options?: { mode?: 'semantic' | 'broad'; onProgress?: (progress: any) => void | Promise<void> }) => {
      await options?.onProgress?.({
        total: 2,
        completed: 1,
        generatedMutants: 3,
        skipped: 1,
        currentMutation: 'negate:ready',
        killed: 1,
        survived: 0,
        invalid: 0,
        equivalent: 0,
        budgetPerMutation: 100,
        autotestRuns: 1,
        autotestSteps: 9,
      });
      return new Promise<MutateResult>(resolve => {
        resolveRun = resolve;
      });
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'mutants', mutate });

    buttonByText(host, 'Run Semantic Mutants').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    await flushPromises();

    expect(host.textContent).toContain('Progress: 1/2 scored mutants');
    expect(host.textContent).toContain('Generated 3');
    expect(host.textContent).toContain('Skipped 1');
    expect(host.textContent).toContain('Now: negate:ready');
    expect(host.textContent).toContain('Autotest runs: 1 · Steps: 9');

    resolveRun?.(mutationResult());
    await flushPromises();
    expect(host.textContent).toContain('Last run: #1 completed');

    handle.dispose();
  });
});
