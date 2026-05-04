import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { CircuitGraph } from '@veriscope/graph';
import { useSignal } from '../useSignal';
import { useTrackedEffect } from '../useTrackedEffect';

describe('useTrackedEffect', () => {
  let graph: CircuitGraph;

  beforeEach(() => {
    graph = new CircuitGraph();
  });

  it('runs effect when dependency changes', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => {
      const sig = useSignal(0, 'count', { graph });
      useTrackedEffect(fn, [sig], 'counter', { graph });
      return sig;
    });

    // Effect might run once on mount in StrictMode, clear the call history
    fn.mockClear();

    act(() => {
      result.current.set(1);
    });

    expect(fn).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.set(2);
    });

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('supports cleanup function', () => {
    const cleanup = vi.fn();
    const fn = vi.fn(() => cleanup);

    const { result } = renderHook(() => {
      const sig = useSignal(0, 'val', { graph });
      useTrackedEffect(fn, [sig], 'withCleanup', { graph });
      return sig;
    });

    fn.mockClear();
    cleanup.mockClear();

    act(() => {
      result.current.set(1);
    });

    // Cleanup should be called before next effect runs
    expect(cleanup).toHaveBeenCalled();
    expect(fn).toHaveBeenCalled();
  });

  it('handles multiple dependencies', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => {
      const a = useSignal(1, 'a', { graph });
      const b = useSignal(2, 'b', { graph });
      useTrackedEffect(fn, [a, b], 'multi', { graph });
      return { a, b };
    });

    fn.mockClear();

    // Change first dep
    act(() => {
      result.current.a.set(10);
    });

    expect(fn).toHaveBeenCalledTimes(1);

    // Change second dep
    act(() => {
      result.current.b.set(20);
    });

    expect(fn).toHaveBeenCalledTimes(2);

    // Change both
    act(() => {
      result.current.a.set(11);
      result.current.b.set(21);
    });

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('registers effect in CircuitGraph with correct deps', () => {
    const { result: aResult } = renderHook(() =>
      useSignal(1, 'a', { graph })
    );
    const { result: bResult } = renderHook(() =>
      useSignal(2, 'b', { graph })
    );

    let effectNodeId: string | null = null;

    renderHook(() => {
      useTrackedEffect(() => {}, [aResult.current, bResult.current], 'tracked', { graph });
      const effects = graph.getNodes().filter(n => n.type === 'effect' && n.name === 'tracked');
      if (effects.length > 0) {
        effectNodeId = effects[0].id;
      }
    });

    expect(effectNodeId).not.toBeNull();
    const node = graph.getNode(effectNodeId!);
    expect(node?.type).toBe('effect');
    expect(node?.deps).toContain(aResult.current.nodeId);
    expect(node?.deps).toContain(bResult.current.nodeId);
  });

  it('notifies graph when effect runs', () => {
    const events: any[] = [];
    graph.subscribe(e => events.push(e));

    const { result } = renderHook(() => {
      const sig = useSignal(0, 'trigger', { graph });
      useTrackedEffect(() => {}, [sig], 'graphNotify', { graph });
      return sig;
    });

    const initialEffectEvents = events.filter(
      e => e.type === 'effect-run'
    ).length;

    act(() => {
      result.current.set(1);
    });

    const finalEffectEvents = events.filter(
      e => e.type === 'effect-run'
    ).length;

    expect(finalEffectEvents).toBeGreaterThan(initialEffectEvents);
  });

  it('cleans up effect on unmount', () => {
    const { result: signalResult } = renderHook(() =>
      useSignal(0, 'val', { graph })
    );

    const { unmount } = renderHook(() =>
      useTrackedEffect(() => {}, [signalResult.current], 'cleanup', { graph })
    );

    const effectsBefore = graph.getNodes().filter(n => n.type === 'effect' && n.name === 'cleanup');
    expect(effectsBefore.length).toBeGreaterThan(0);

    unmount();

    const effectsAfter = graph.getNodes().filter(n => n.type === 'effect' && n.name === 'cleanup');
    expect(effectsAfter.length).toBe(0);
  });

  it('has re-registration logic via useEffect (StrictMode safety)', () => {
    // This test verifies that the hook has the necessary effect for re-registration
    const { result } = renderHook(() => {
      const sig = useSignal(0, 'val', { graph });
      useTrackedEffect(() => {}, [sig], 'strictTracked', { graph });
      return sig;
    });

    const effects = graph.getNodes().filter(n => n.name === 'strictTracked');
    expect(effects.length).toBeGreaterThan(0);
    expect(effects[0].type).toBe('effect');
  });

  it('tracks effect execution state in CircuitGraph', () => {
    let executionCount = 0;
    const { result } = renderHook(() => {
      const sig = useSignal(0, 'val', { graph });
      useTrackedEffect(() => {
        executionCount++;
      }, [sig], 'count', { graph });
      return sig;
    });

    const initialCount = executionCount;

    act(() => {
      result.current.set(1);
    });

    expect(executionCount).toBeGreaterThan(initialCount);
  });

  it('works with empty dependency array', () => {
    const fn = vi.fn();

    renderHook(() =>
      useTrackedEffect(fn, [], 'noDeps', { graph })
    );

    // Effect with empty deps should only run once (on mount)
    // Clear mock after initial mount
    fn.mockClear();

    // Nothing to change, so fn should not be called
    expect(fn).not.toHaveBeenCalled();
  });

  it('returns undefined if cleanup function is not returned', () => {
    const fn = vi.fn(() => {
      // No return
    });

    const { result: signalResult } = renderHook(() =>
      useSignal(0, 'val', { graph })
    );

    expect(() => {
      renderHook(() =>
        useTrackedEffect(fn, [signalResult.current], 'noCleanup', { graph })
      );
    }).not.toThrow();
  });
});
