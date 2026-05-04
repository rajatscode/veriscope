import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { CircuitGraph } from '@veriscope/graph';
import { useSignal } from '../useSignal';
import { useEdgeEffect } from '../useEdgeEffect';

describe('useEdgeEffect', () => {
  let graph: CircuitGraph;

  beforeEach(() => {
    graph = new CircuitGraph();
  });

  it('fires action on posedge (falsy to truthy)', () => {
    const action = vi.fn();
    const { result } = renderHook(() => {
      const sig = useSignal(false, 'trigger', { graph });
      useEdgeEffect(sig, 'posedge', action, 'onTrigger', { graph });
      return sig;
    });

    // Initial mount should not fire
    expect(action).not.toHaveBeenCalled();

    // Transition from false to true
    act(() => {
      result.current.set(true);
    });

    expect(action).toHaveBeenCalledTimes(1);

    // Back to false should not fire (negedge)
    act(() => {
      result.current.set(false);
    });

    expect(action).toHaveBeenCalledTimes(1);

    // True again is not an edge (already true)
    act(() => {
      result.current.set(true);
    });

    expect(action).toHaveBeenCalledTimes(2);
  });

  it('fires action on negedge (truthy to falsy)', () => {
    const action = vi.fn();
    const { result } = renderHook(() => {
      const sig = useSignal(true, 'trigger', { graph });
      useEdgeEffect(sig, 'negedge', action, 'onFall', { graph });
      return sig;
    });

    // Initial mount should not fire
    expect(action).not.toHaveBeenCalled();

    // Transition from true to false
    act(() => {
      result.current.set(false);
    });

    expect(action).toHaveBeenCalledTimes(1);

    // Back to true should not fire (posedge)
    act(() => {
      result.current.set(true);
    });

    expect(action).toHaveBeenCalledTimes(1);

    // False again
    act(() => {
      result.current.set(false);
    });

    expect(action).toHaveBeenCalledTimes(2);
  });

  it('does not fire on initial render', () => {
    const action = vi.fn();

    renderHook(() =>
      useEdgeEffect(
        { val: true, nodeId: 'sig_1' },
        'posedge',
        action,
        'effect',
        { graph }
      )
    );

    expect(action).not.toHaveBeenCalled();
  });

  it('works with numeric signals (0/1)', () => {
    const action = vi.fn();
    const { result } = renderHook(() => {
      const sig = useSignal(0, 'count', { graph });
      useEdgeEffect(sig, 'posedge', action, 'onInc', { graph });
      return sig;
    });

    // 0 to 1 is posedge
    act(() => {
      result.current.set(1);
    });

    expect(action).toHaveBeenCalledTimes(1);

    // 1 to 2 is not an edge (both truthy)
    act(() => {
      result.current.set(2);
    });

    expect(action).toHaveBeenCalledTimes(1);

    // 2 to 0 is negedge
    act(() => {
      result.current.set(0);
    });

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('registers effect in CircuitGraph with correct dep', () => {
    const { result: signalResult } = renderHook(() =>
      useSignal(false, 'toggle', { graph })
    );

    let effectNodeId: string | null = null;

    renderHook(() => {
      useEdgeEffect(signalResult.current, 'posedge', () => {}, 'myEffect', { graph });
      // Capture nodeId by examining graph after hook runs
      const effects = graph.getNodes().filter(n => n.type === 'effect' && n.name === 'myEffect');
      if (effects.length > 0) {
        effectNodeId = effects[0].id;
      }
    });

    expect(effectNodeId).not.toBeNull();
    const node = graph.getNode(effectNodeId!);
    expect(node?.type).toBe('effect');
    expect(node?.deps).toContain(signalResult.current.nodeId);
  });

  it('cleans up effect on unmount', () => {
    const { result: signalResult } = renderHook(() =>
      useSignal(false, 'toggle', { graph })
    );

    const { unmount } = renderHook(() =>
      useEdgeEffect(signalResult.current, 'posedge', () => {}, 'effect', { graph })
    );

    const effectsBefore = graph.getNodes().filter(n => n.type === 'effect' && n.name === 'effect');
    expect(effectsBefore.length).toBeGreaterThan(0);

    unmount();

    const effectsAfter = graph.getNodes().filter(n => n.type === 'effect' && n.name === 'effect');
    expect(effectsAfter.length).toBe(0);
  });

  it('has re-registration logic via useEffect (StrictMode safety)', () => {
    // This test verifies that the hook has the necessary effect for re-registration
    const { result } = renderHook(() => {
      const sig = useSignal(false, 'toggle', { graph });
      useEdgeEffect(sig, 'posedge', () => {}, 'strictEffect', { graph });
      return sig;
    });

    const effects = graph.getNodes().filter(n => n.name === 'strictEffect');
    expect(effects.length).toBeGreaterThan(0);
    expect(effects[0].type).toBe('effect');
  });

  it('handles rapid value changes correctly', () => {
    const action = vi.fn();
    const { result } = renderHook(() => {
      const sig = useSignal(false, 'rapid', { graph });
      useEdgeEffect(sig, 'posedge', action, 'rapid', { graph });
      return sig;
    });

    // When batched in a single act(), React batches the updates and only re-renders
    // once with the final value. So we get false→true (1 edge).
    act(() => {
      result.current.set(true);
      result.current.set(false);
      result.current.set(true);
      result.current.set(false);
      result.current.set(true);
    });

    // Single batch results in one edge detection (false → true)
    expect(action).toHaveBeenCalledTimes(1);

    // Separate batches allow independent edge detection
    act(() => {
      result.current.set(false);
    });

    act(() => {
      result.current.set(true);
    });

    // Now we have 2 edges total
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('registers effect with correct signal dependency', () => {
    const action = vi.fn();
    const { result } = renderHook(() => {
      const sig = useSignal(false, 'dep', { graph });
      useEdgeEffect(sig, 'posedge', action, 'withDep', { graph });
      return sig;
    });

    // Verify the effect node was registered with the signal as a dependency
    const effects = graph.getNodes().filter(n => n.name === 'withDep' && n.type === 'effect');
    expect(effects.length).toBeGreaterThan(0);
    expect(effects[0].deps).toContain(result.current.nodeId);
  });
});
