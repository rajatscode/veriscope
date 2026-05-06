import { describe, it, expect, beforeEach } from 'vitest';
import { createRoot } from 'solid-js';
import { CircuitGraph } from '@veriscope/graph';
import { useSignal } from '../useSignal';

describe('useSignal', () => {
  let graph: CircuitGraph;

  beforeEach(() => {
    graph = new CircuitGraph();
  });

  it('creates a signal with initial value', () => {
    createRoot(dispose => {
      const sig = useSignal(42, 'count', { graph });
      expect(sig.val).toBe(42);
      dispose();
    });
  });

  it('updates value via set()', () => {
    createRoot(dispose => {
      const sig = useSignal(0, 'count', { graph });
      sig.set(5);
      expect(sig.val).toBe(5);
      dispose();
    });
  });

  it('supports updater functions via set()', () => {
    createRoot(dispose => {
      const sig = useSignal(1, 'count', { graph });
      sig.set(prev => prev + 4);
      expect(sig.val).toBe(5);
      expect(graph.getNode(sig.nodeId)?.getValue?.()).toBe(5);
      dispose();
    });
  });

  it('supports updater functions through graph-driven setters', () => {
    createRoot(dispose => {
      const sig = useSignal(2, 'count', { graph });
      graph.driveNodeValue(sig.nodeId, (prev: number) => prev + 3);
      expect(sig.val).toBe(5);
      expect(graph.getNode(sig.nodeId)?.getValue?.()).toBe(5);
      dispose();
    });
  });

  it('registers signal in CircuitGraph', () => {
    createRoot(dispose => {
      const sig = useSignal('initial', 'mySignal', { graph });
      const node = graph.getNode(sig.nodeId);
      expect(node).toBeDefined();
      expect(node?.type).toBe('signal');
      expect(node?.name).toBe('mySignal');
      dispose();
    });
  });

  it('notifies graph on value change', () => {
    createRoot(dispose => {
      const events: any[] = [];
      graph.subscribe(e => events.push(e));

      const sig = useSignal(0, 'counter', { graph });
      sig.set(1);

      const changeEvents = events.filter(e => e.type === 'signal-change');
      expect(changeEvents.length).toBeGreaterThan(0);
      expect(changeEvents[0].newValue).toBe(1);
      dispose();
    });
  });

  it('skips graph notification if value is identical (Object.is)', () => {
    createRoot(dispose => {
      const events: any[] = [];
      graph.subscribe(e => events.push(e));

      const sig = useSignal(5, 'val', { graph });
      const initialEventCount = events.length;

      sig.set(5);

      expect(events.length).toBe(initialEventCount);
      dispose();
    });
  });

  it('stores states metadata when provided', () => {
    createRoot(dispose => {
      const sig = useSignal('red', 'color', {
        graph,
        states: ['red', 'green', 'blue'],
      });

      const node = graph.getNode(sig.nodeId);
      expect(node?.metadata?.states).toEqual(['red', 'green', 'blue']);
      dispose();
    });
  });

  it('stores explicit coverage metadata when provided', () => {
    createRoot(dispose => {
      const sig = useSignal(0, 'mode', {
        graph,
        states: [0, 1],
        coverage: 'transition',
      });

      const node = graph.getNode(sig.nodeId);
      expect(node?.metadata?.states).toEqual([0, 1]);
      expect(node?.metadata?.coverage).toBe('transition');
      dispose();
    });
  });

  it('does not store coverage metadata for auto', () => {
    createRoot(dispose => {
      const sig = useSignal(0, 'mode', {
        graph,
        coverage: 'auto',
      });

      const node = graph.getNode(sig.nodeId);
      expect(node?.metadata?.coverage).toBeUndefined();
      dispose();
    });
  });

  it('passes stable path and scope metadata through to graph snapshots', () => {
    createRoot(dispose => {
      const sig = useSignal(1, 'value', {
        graph,
        stablePath: 'List/Row:42/value',
        scope: 'List/Row:42',
      });

      const node = graph.getNode(sig.nodeId);
      const snap = graph.snapshot();

      expect(node?.stablePath).toBe('List/Row:42/value');
      expect(node?.metadata?.scope).toBe('List/Row:42');
      expect(snap.nodes[0].stablePath).toBe('List/Row:42/value');
      dispose();
    });
  });

  it('cleans up node on disposal', () => {
    let nodeId: string;
    createRoot(dispose => {
      const sig = useSignal(1, 'signal', { graph });
      nodeId = sig.nodeId;
      expect(graph.getNode(nodeId)).toBeDefined();
      dispose();
    });
    expect(graph.getNode(nodeId!)).toBeUndefined();
  });

  it('exposes name on signal object', () => {
    createRoot(dispose => {
      const sig = useSignal(0, 'myName', { graph });
      expect(sig.name).toBe('myName');
      dispose();
    });
  });

  it('batches graph mutations correctly', () => {
    createRoot(dispose => {
      const events: any[] = [];
      graph.subscribe(e => events.push(e));

      const sig = useSignal(0, 'batched', { graph });

      graph.beginBatch();
      sig.set(1);
      sig.set(2);
      graph.endBatch();

      const changes = events.filter(e => e.type === 'signal-change');
      expect(changes.length).toBeGreaterThan(0);
      dispose();
    });
  });
});
