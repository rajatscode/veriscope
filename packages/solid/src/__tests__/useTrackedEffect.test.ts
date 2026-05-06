import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot } from 'solid-js';
import { CircuitGraph } from '@veriscope/graph';
import { useSignal } from '../useSignal';
import { useTrackedEffect } from '../useTrackedEffect';

const tick = () => new Promise<void>(r => queueMicrotask(r));

describe('useTrackedEffect', () => {
  let graph: CircuitGraph;

  beforeEach(() => {
    graph = new CircuitGraph();
  });

  it('runs effect when dependency changes', async () => {
    await createRoot(async dispose => {
      const fn = vi.fn();
      const sig = useSignal(0, 'count', { graph });
      useTrackedEffect(fn, [sig], 'counter', { graph });

      await tick();
      fn.mockClear();

      sig.set(1);
      await tick();
      expect(fn).toHaveBeenCalledTimes(1);

      sig.set(2);
      await tick();
      expect(fn).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('supports cleanup function', async () => {
    await createRoot(async dispose => {
      const cleanup = vi.fn();
      const fn = vi.fn(() => cleanup);

      const sig = useSignal(0, 'val', { graph });
      useTrackedEffect(fn, [sig], 'withCleanup', { graph });

      await tick();
      fn.mockClear();
      cleanup.mockClear();

      sig.set(1);
      await tick();
      expect(fn).toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalled();
      dispose();
    });
  });

  it('handles multiple dependencies', async () => {
    await createRoot(async dispose => {
      const fn = vi.fn();
      const a = useSignal(1, 'a', { graph });
      const b = useSignal(2, 'b', { graph });
      useTrackedEffect(fn, [a, b], 'multi', { graph });

      await tick();
      fn.mockClear();

      a.set(10);
      await tick();
      expect(fn).toHaveBeenCalledTimes(1);

      b.set(20);
      await tick();
      expect(fn).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('registers effect in CircuitGraph with correct deps', () => {
    createRoot(dispose => {
      const a = useSignal(1, 'a', { graph });
      const b = useSignal(2, 'b', { graph });
      useTrackedEffect(() => {}, [a, b], 'tracked', { graph });

      const effects = graph.getNodes().filter(n => n.type === 'effect' && n.name === 'tracked');
      expect(effects.length).toBeGreaterThan(0);
      expect(effects[0].deps).toContain(a.nodeId);
      expect(effects[0].deps).toContain(b.nodeId);
      dispose();
    });
  });

  it('notifies graph when effect runs', async () => {
    await createRoot(async dispose => {
      const events: any[] = [];
      graph.subscribe(e => events.push(e));

      const sig = useSignal(0, 'trigger', { graph });
      useTrackedEffect(() => {}, [sig], 'graphNotify', { graph });

      await tick();
      const initialEffectEvents = events.filter(e => e.type === 'effect-run').length;

      sig.set(1);
      await tick();

      const finalEffectEvents = events.filter(e => e.type === 'effect-run').length;
      expect(finalEffectEvents).toBeGreaterThan(initialEffectEvents);
      dispose();
    });
  });

  it('cleans up effect on disposal', () => {
    let effectName = 'cleanup';
    createRoot(dispose => {
      const sig = useSignal(0, 'val', { graph });
      useTrackedEffect(() => {}, [sig], effectName, { graph });

      const effectsBefore = graph.getNodes().filter(n => n.type === 'effect' && n.name === effectName);
      expect(effectsBefore.length).toBeGreaterThan(0);
      dispose();
    });

    const effectsAfter = graph.getNodes().filter(n => n.type === 'effect' && n.name === 'cleanup');
    expect(effectsAfter.length).toBe(0);
  });

  it('passes scope metadata through', () => {
    createRoot(dispose => {
      const sig = useSignal(0, 'val', { graph });
      useTrackedEffect(() => {}, [sig], 'scopedTracked', {
        graph,
        scope: 'MyScope',
        stablePath: 'MyScope/scopedTracked',
      });

      const effects = graph.getNodes().filter(n => n.name === 'scopedTracked');
      expect(effects.length).toBeGreaterThan(0);
      expect(effects[0].metadata?.scope).toBe('MyScope');
      expect(effects[0].stablePath).toBe('MyScope/scopedTracked');
      dispose();
    });
  });

  it('runs final cleanup on disposal', async () => {
    const cleanup = vi.fn();
    await createRoot(async dispose => {
      const fn = vi.fn(() => cleanup);
      const sig = useSignal(0, 'val', { graph });
      useTrackedEffect(fn, [sig], 'finalCleanup', { graph });

      await tick();
      cleanup.mockClear();
      dispose();
    });
    expect(cleanup).toHaveBeenCalled();
  });
});
