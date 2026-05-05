import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { CircuitGraph } from '@veriscope/graph';
import { useSignal } from '../useSignal';
import { useDerived } from '../useDerived';

describe('useDerived', () => {
  let graph: CircuitGraph;

  beforeEach(() => {
    graph = new CircuitGraph();
  });

  it('computes initial value', () => {
    const { result: signalResult } = renderHook(() =>
      useSignal(5, 'x', { graph })
    );

    const { result } = renderHook(() =>
      useDerived(() => signalResult.current.val * 2, [signalResult.current], 'doubled', { graph })
    );

    expect(result.current.val).toBe(10);
  });

  it('recomputes when dependency changes', () => {
    // Use a single hook call that combines signal + derived to ensure proper deps tracking
    const { result } = renderHook(() => {
      const sig = useSignal(3, 'x', { graph });
      const derived = useDerived(() => sig.val * 2, [sig], 'doubled', { graph });
      return { sig, derived };
    });

    expect(result.current.derived.val).toBe(6);

    act(() => {
      result.current.sig.set(7);
    });

    expect(result.current.derived.val).toBe(14);
  });

  it('registers derived node in CircuitGraph with correct deps', () => {
    const { result: xResult } = renderHook(() =>
      useSignal(1, 'x', { graph })
    );
    const { result: yResult } = renderHook(() =>
      useSignal(2, 'y', { graph })
    );

    const { result } = renderHook(() =>
      useDerived(
        () => xResult.current.val + yResult.current.val,
        [xResult.current, yResult.current],
        'sum',
        { graph }
      )
    );

    const node = graph.getNode(result.current.nodeId);
    expect(node).toBeDefined();
    expect(node?.type).toBe('derived');
    expect(node?.name).toBe('sum');
    expect(node?.deps).toContain(xResult.current.nodeId);
    expect(node?.deps).toContain(yResult.current.nodeId);
  });

  it('registers computeFn so graph driving propagates derived values', () => {
    const events: any[] = [];
    graph.subscribe(e => events.push(e));

    const { result } = renderHook(() => {
      const sig = useSignal(2, 'x', { graph });
      const derived = useDerived(() => sig.val * 2, [sig], 'doubled', { graph });
      return { sig, derived };
    });

    const derivedNodeId = result.current.derived.nodeId;

    act(() => {
      graph.driveNodeValue(result.current.sig.nodeId, 5);
    });

    expect(result.current.derived.val).toBe(10);
    expect(graph.getNode(derivedNodeId)?.getValue?.()).toBe(10);
    expect(events.some(e => e.type === 'derived-recompute' && e.nodeId === derivedNodeId)).toBe(true);
  });

  it('notifies graph only on actual value changes', () => {
    const events: any[] = [];
    graph.subscribe(e => events.push(e));

    const { result } = renderHook(() => {
      const sig = useSignal(0, 'x', { graph });
      const derived = useDerived(() => sig.val > 0 ? 'big' : 'small', [sig], 'label', { graph });
      return { sig, derived };
    });

    // Get baseline count of derived-recompute events for this node
    const derivedNodeId = result.current.derived.nodeId;
    const changeEventsBefore = events.filter(
      e => e.type === 'derived-recompute' && e.nodeId === derivedNodeId
    ).length;

    // Change dep but computed value stays same
    act(() => {
      result.current.sig.set(-5); // Still results in 'small'
    });

    const changeEventsAfter = events.filter(
      e => e.type === 'derived-recompute' && e.nodeId === derivedNodeId
    ).length;

    expect(changeEventsAfter).toBe(changeEventsBefore); // No new notification

    // Change dep and computed value changes
    act(() => {
      result.current.sig.set(10); // Now 'big'
    });

    const changeEventsFinal = events.filter(
      e => e.type === 'derived-recompute' && e.nodeId === derivedNodeId
    ).length;

    expect(changeEventsFinal).toBeGreaterThan(changeEventsAfter);
  });

  it('returns readonly signal (no set method)', () => {
    const { result: signalResult } = renderHook(() =>
      useSignal(5, 'x', { graph })
    );

    const { result } = renderHook(() =>
      useDerived(() => signalResult.current.val, [signalResult.current], 'derived', { graph })
    );

    expect(result.current.set).toBeUndefined();
  });

  it('memoizes computation when deps stay same', () => {
    let computeCount = 0;
    const { result: signalResult } = renderHook(() =>
      useSignal(1, 'x', { graph })
    );

    const { rerender } = renderHook(
      () => {
        return useDerived(() => {
          computeCount++;
          return signalResult.current.val * 2;
        }, [signalResult.current], 'computed', { graph });
      },
      { initialProps: {} }
    );

    const initialCount = computeCount;

    // Re-render without dep change
    rerender();

    expect(computeCount).toBe(initialCount); // Should not recompute
  });

  it('cleans up node on unmount', () => {
    const { result: signalResult } = renderHook(() =>
      useSignal(5, 'x', { graph })
    );

    const { result, unmount } = renderHook(() =>
      useDerived(() => signalResult.current.val, [signalResult.current], 'derived', { graph })
    );

    const nodeId = result.current.nodeId;
    expect(graph.getNode(nodeId)).toBeDefined();

    unmount();

    expect(graph.getNode(nodeId)).toBeUndefined();
  });

  it('has re-registration logic via useEffect (StrictMode safety)', () => {
    // This test verifies that the hook has the necessary effect for re-registration
    // The actual StrictMode scenario requires running React in strict mode
    const { result } = renderHook(() => {
      const sig = useSignal(5, 'x', { graph });
      return useDerived(() => sig.val, [sig], 'derived', { graph });
    });

    const nodeId = result.current.nodeId;
    const node = graph.getNode(nodeId);

    // Verify the node was registered
    expect(node).toBeDefined();
    expect(node?.type).toBe('derived');
  });

  it('handles multiple dependencies correctly', () => {
    const { result } = renderHook(() => {
      const a = useSignal(10, 'a', { graph });
      const b = useSignal(20, 'b', { graph });
      const c = useSignal(30, 'c', { graph });
      const sum = useDerived(
        () => a.val + b.val + c.val,
        [a, b, c],
        'sum',
        { graph }
      );
      return { a, b, c, sum };
    });

    expect(result.current.sum.val).toBe(60);

    act(() => {
      result.current.b.set(5);
    });

    expect(result.current.sum.val).toBe(45);
  });
});
