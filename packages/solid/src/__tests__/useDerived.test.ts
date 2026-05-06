import { describe, it, expect, beforeEach } from 'vitest';
import { createRoot } from 'solid-js';
import { CircuitGraph } from '@veriscope/graph';
import { useSignal } from '../useSignal';
import { useDerived } from '../useDerived';

describe('useDerived', () => {
  let graph: CircuitGraph;

  beforeEach(() => {
    graph = new CircuitGraph();
  });

  it('computes initial value', () => {
    createRoot(dispose => {
      const sig = useSignal(5, 'x', { graph });
      const derived = useDerived(() => sig.val * 2, [sig], 'doubled', { graph });
      expect(derived.val).toBe(10);
      dispose();
    });
  });

  it('recomputes when dependency changes', () => {
    createRoot(dispose => {
      const sig = useSignal(3, 'x', { graph });
      const derived = useDerived(() => sig.val * 2, [sig], 'doubled', { graph });
      expect(derived.val).toBe(6);

      sig.set(7);
      expect(derived.val).toBe(14);
      dispose();
    });
  });

  it('registers derived node in CircuitGraph with correct deps', () => {
    createRoot(dispose => {
      const x = useSignal(1, 'x', { graph });
      const y = useSignal(2, 'y', { graph });
      const sum = useDerived(() => x.val + y.val, [x, y], 'sum', { graph });

      const node = graph.getNode(sum.nodeId);
      expect(node).toBeDefined();
      expect(node?.type).toBe('derived');
      expect(node?.name).toBe('sum');
      expect(node?.deps).toContain(x.nodeId);
      expect(node?.deps).toContain(y.nodeId);
      dispose();
    });
  });

  it('passes stable path and scope metadata through for derived nodes', () => {
    createRoot(dispose => {
      const sig = useSignal(3, 'x', { graph, stablePath: 'Widget:x' });
      const derived = useDerived(() => sig.val * 2, [sig], 'doubled', {
        graph,
        stablePath: 'Widget:doubled',
        scope: 'Widget',
      });

      const node = graph.getNode(derived.nodeId);
      expect(node?.stablePath).toBe('Widget:doubled');
      expect(node?.metadata?.scope).toBe('Widget');
      dispose();
    });
  });

  it('stores coverage metadata when provided', () => {
    createRoot(dispose => {
      const sig = useSignal(1, 'x', { graph });
      const derived = useDerived(() => sig.val > 0, [sig], 'positive', {
        graph,
        coverage: 'transition',
      });

      const node = graph.getNode(derived.nodeId);
      expect(node?.metadata?.coverage).toBe('transition');
      dispose();
    });
  });

  it('does not store coverage metadata for auto', () => {
    createRoot(dispose => {
      const sig = useSignal(1, 'x', { graph });
      const derived = useDerived(() => sig.val > 0, [sig], 'positive', {
        graph,
        coverage: 'auto',
      });

      const node = graph.getNode(derived.nodeId);
      expect(node?.metadata?.coverage).toBeUndefined();
      dispose();
    });
  });

  it('registers computeFn so graph driving propagates derived values', () => {
    createRoot(dispose => {
      const events: any[] = [];
      graph.subscribe(e => events.push(e));

      const sig = useSignal(2, 'x', { graph });
      const derived = useDerived(() => sig.val * 2, [sig], 'doubled', { graph });

      graph.driveNodeValue(sig.nodeId, 5);

      expect(derived.val).toBe(10);
      expect(graph.getNode(derived.nodeId)?.getValue?.()).toBe(10);
      expect(events.some(e => e.type === 'derived-recompute' && e.nodeId === derived.nodeId)).toBe(true);
      dispose();
    });
  });

  it('notifies graph only on actual value changes', () => {
    createRoot(dispose => {
      const events: any[] = [];
      graph.subscribe(e => events.push(e));

      const sig = useSignal(0, 'x', { graph });
      const derived = useDerived(() => sig.val > 0 ? 'big' : 'small', [sig], 'label', { graph });

      const derivedNodeId = derived.nodeId;
      const changeEventsBefore = events.filter(
        e => e.type === 'derived-recompute' && e.nodeId === derivedNodeId
      ).length;

      sig.set(-5); // Still 'small'

      const changeEventsAfter = events.filter(
        e => e.type === 'derived-recompute' && e.nodeId === derivedNodeId
      ).length;
      expect(changeEventsAfter).toBe(changeEventsBefore);

      sig.set(10); // Now 'big'

      const changeEventsFinal = events.filter(
        e => e.type === 'derived-recompute' && e.nodeId === derivedNodeId
      ).length;
      expect(changeEventsFinal).toBeGreaterThan(changeEventsAfter);
      dispose();
    });
  });

  it('returns readonly signal (no set method)', () => {
    createRoot(dispose => {
      const sig = useSignal(5, 'x', { graph });
      const derived = useDerived(() => sig.val, [sig], 'derived', { graph });
      expect((derived as any).set).toBeUndefined();
      dispose();
    });
  });

  it('handles multiple dependencies correctly', () => {
    createRoot(dispose => {
      const a = useSignal(10, 'a', { graph });
      const b = useSignal(20, 'b', { graph });
      const c = useSignal(30, 'c', { graph });
      const sum = useDerived(() => a.val + b.val + c.val, [a, b, c], 'sum', { graph });

      expect(sum.val).toBe(60);

      b.set(5);
      expect(sum.val).toBe(45);
      dispose();
    });
  });

  it('cleans up node on disposal', () => {
    let nodeId: string;
    createRoot(dispose => {
      const sig = useSignal(5, 'x', { graph });
      const derived = useDerived(() => sig.val, [sig], 'derived', { graph });
      nodeId = derived.nodeId;
      expect(graph.getNode(nodeId)).toBeDefined();
      dispose();
    });
    expect(graph.getNode(nodeId!)).toBeUndefined();
  });
});
