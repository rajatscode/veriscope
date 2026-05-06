import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot } from 'solid-js';
import { CircuitGraph } from '@veriscope/graph';
import { useSignal } from '../useSignal';
import { useEdgeEffect } from '../useEdgeEffect';

const tick = () => new Promise<void>(r => queueMicrotask(r));

describe('useEdgeEffect', () => {
  let graph: CircuitGraph;

  beforeEach(() => {
    graph = new CircuitGraph();
  });

  it('fires action on posedge (falsy to truthy)', async () => {
    await createRoot(async dispose => {
      const action = vi.fn();
      const sig = useSignal(false, 'trigger', { graph });
      useEdgeEffect(sig, 'posedge', action, 'onTrigger', { graph });

      await tick();
      expect(action).not.toHaveBeenCalled();

      sig.set(true);
      await tick();
      expect(action).toHaveBeenCalledTimes(1);

      sig.set(false);
      await tick();
      expect(action).toHaveBeenCalledTimes(1);

      sig.set(true);
      await tick();
      expect(action).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('fires action on negedge (truthy to falsy)', async () => {
    await createRoot(async dispose => {
      const action = vi.fn();
      const sig = useSignal(true, 'trigger', { graph });
      useEdgeEffect(sig, 'negedge', action, 'onFall', { graph });

      await tick();
      expect(action).not.toHaveBeenCalled();

      sig.set(false);
      await tick();
      expect(action).toHaveBeenCalledTimes(1);

      sig.set(true);
      await tick();
      expect(action).toHaveBeenCalledTimes(1);

      sig.set(false);
      await tick();
      expect(action).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it('does not fire on initial creation', async () => {
    await createRoot(async dispose => {
      const action = vi.fn();
      const sig = useSignal(true, 'trigger', { graph });
      useEdgeEffect(sig, 'posedge', action, 'effect', { graph });
      await tick();
      expect(action).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('works with numeric signals (0/1)', async () => {
    await createRoot(async dispose => {
      const action = vi.fn();
      const sig = useSignal(0, 'count', { graph });
      useEdgeEffect(sig, 'posedge', action, 'onInc', { graph });
      await tick();

      sig.set(1);
      await tick();
      expect(action).toHaveBeenCalledTimes(1);

      sig.set(2); // truthy to truthy, not an edge
      await tick();
      expect(action).toHaveBeenCalledTimes(1);

      sig.set(0); // negedge, not posedge
      await tick();
      expect(action).toHaveBeenCalledTimes(1);
      dispose();
    });
  });

  it('registers effect in CircuitGraph with correct dep', () => {
    createRoot(dispose => {
      const sig = useSignal(false, 'toggle', { graph });
      useEdgeEffect(sig, 'posedge', () => {}, 'myEffect', { graph });

      const effects = graph.getNodes().filter(n => n.type === 'effect' && n.name === 'myEffect');
      expect(effects.length).toBeGreaterThan(0);
      expect(effects[0].deps).toContain(sig.nodeId);
      dispose();
    });
  });

  it('cleans up effect on disposal', () => {
    let effectName = 'cleanupEffect';
    createRoot(dispose => {
      const sig = useSignal(false, 'toggle', { graph });
      useEdgeEffect(sig, 'posedge', () => {}, effectName, { graph });

      const effectsBefore = graph.getNodes().filter(n => n.type === 'effect' && n.name === effectName);
      expect(effectsBefore.length).toBeGreaterThan(0);
      dispose();
    });

    const effectsAfter = graph.getNodes().filter(n => n.type === 'effect' && n.name === 'cleanupEffect');
    expect(effectsAfter.length).toBe(0);
  });

  it('passes scope metadata through', () => {
    createRoot(dispose => {
      const sig = useSignal(false, 'toggle', { graph });
      useEdgeEffect(sig, 'posedge', () => {}, 'scopedEffect', {
        graph,
        scope: 'MyComponent',
        stablePath: 'MyComponent/scopedEffect',
      });

      const effects = graph.getNodes().filter(n => n.name === 'scopedEffect');
      expect(effects.length).toBeGreaterThan(0);
      expect(effects[0].metadata?.scope).toBe('MyComponent');
      expect(effects[0].stablePath).toBe('MyComponent/scopedEffect');
      dispose();
    });
  });
});
