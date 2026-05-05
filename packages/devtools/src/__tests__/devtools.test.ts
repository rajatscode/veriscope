// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitGraph, coverage } from '@veriscope/graph';
import { mountDevtools } from '../index';
import type { AutotestResult, MutateResult } from '../index';

const canvasText: string[] = [];

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
  coverage.reset();

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
  it('mounts the four product tabs and redraws Circuit on graph events', () => {
    const graph = new CircuitGraph();
    graph.registerNode({ name: 'first', type: 'signal' });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'circuit' });

    expect(host.textContent).toContain('Circuit');
    expect(host.textContent).toContain('Waveform');
    expect(host.textContent).toContain('Autotest');
    expect(host.textContent).toContain('Mutants');
    expect(canvasText).toContain('first');

    canvasText.length = 0;
    graph.registerNode({ name: 'second', type: 'derived', deps: [] });
    expect(canvasText).toContain('second');

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

  it('runs the package autotest callback and renders coverage results', async () => {
    const graph = new CircuitGraph();
    const assertionId = graph.registerNode({ name: 'invariant', type: 'assertion' });
    graph.setAssertionFn(assertionId, () => true, 'always');
    const autotest = vi.fn(async () => autotestResult(assertionId));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'autotest', autotest, coverage });

    buttonByText(host, 'Run Autotest').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(autotest).toHaveBeenCalledWith(graph, expect.objectContaining({ name: 'devtools-autotest' }));
    expect(host.textContent).toContain('Autotest Results');
    expect(host.textContent).toContain('Coverage: 100.0% (2/2)');

    handle.dispose();
  });

  it('runs mutation callbacks and renders killed and surviving mutants', async () => {
    const graph = new CircuitGraph();
    const mutate = vi.fn(async () => mutationResult());

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDevtools(host, graph, { initialTab: 'mutants', mutate });

    buttonByText(host, 'Run Mutants').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(mutate).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('Score: 50.0%');
    expect(host.textContent).toContain('negate:canSubmit');
    expect(host.textContent).toContain('swap-edge:a:b');

    handle.dispose();
  });
});
