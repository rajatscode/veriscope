// graph.ts — CircuitGraph: introspectable reactive dependency graph
// Extracted from Comb's runtime, simplified for framework-agnostic use

import type { GraphNode, GraphEdge, GraphEvent, GraphSnapshot, GraphDiff, NodeType, AssertionViolation, CdcWarning } from './types.js';
import { coverage } from './coverage.js';

const EVENT_BUFFER_SIZE = 256;

let idCounter = 0;

export class CircuitGraph {
  private nodes = new Map<string, GraphNode>();
  private edges: GraphEdge[] = [];
  private events: GraphEvent[] = [];
  private eventWriteIdx = 0;
  private eventsFull = false;
  private listeners = new Set<(event: GraphEvent) => void>();
  private recording = false;
  private waveforms = new Map<string, Array<{ t: number; v: any }>>();
  private _currentTick = 0;
  private testMode = false;
  private tickOpen = false;
  private coverageEnabled = false;
  private _inAsyncContext = false;
  private nodeLastSetContext = new Map<string, 'sync' | 'async'>();
  private cdcWarningListeners = new Set<(warning: CdcWarning) => void>();

  /** Current simulation tick (increments on closeTick). */
  get currentTick(): number {
    return this._currentTick;
  }

  // --- Node management ---

  registerNode(info: { name: string; type: NodeType; deps?: string[]; metadata?: Record<string, any> }): string {
    const id = `${info.name}_${idCounter++}`;
    this.nodes.set(id, {
      id,
      name: info.name,
      type: info.type,
      deps: info.deps ?? [],
      getValue: null,
      setValue: null,
      metadata: info.metadata,
    });

    // Add edges from deps
    if (info.deps) {
      for (const dep of info.deps) {
        this.edges.push({ from: dep, to: id });
      }
    }

    return id;
  }

  addEdge(from: string, to: string): void {
    const exists = this.edges.some(e => e.from === from && e.to === to);
    if (!exists) {
      this.edges.push({ from, to });
    }
  }

  setNodeValue(id: string, getter: () => any): void {
    const node = this.nodes.get(id);
    if (node) node.getValue = getter;
  }

  setNodeSetter(id: string, setter: (v: any) => void): void {
    const node = this.nodes.get(id);
    if (node) node.setValue = setter;
  }

  setAssertionFn(id: string, fn: () => boolean, kind: 'always' | 'never' | 'after'): void {
    const node = this.nodes.get(id);
    if (node) {
      node.assertionFn = fn;
      node.assertionKind = kind;
    }
  }

  setAssertionUserCheckFn(id: string, userCheckFn: () => boolean): void {
    const node = this.nodes.get(id);
    if (node) {
      if (!node.metadata) node.metadata = {};
      node.metadata.userCheckFn = userCheckFn;
    }
  }

  getAssertionUserCheckFn(id: string): (() => boolean) | undefined {
    const node = this.nodes.get(id);
    return node?.metadata?.userCheckFn;
  }

  disposeNode(id: string): void {
    this.nodes.delete(id);
    this.edges = this.edges.filter(e => e.from !== id && e.to !== id);
    this.waveforms.delete(id);
  }

  // --- Event recording (ring buffer) ---

  private now(): number {
    if (typeof performance !== 'undefined') return performance.now();
    return Date.now();
  }

  private pushEvent(event: GraphEvent): void {
    if (this.eventsFull) {
      this.events[this.eventWriteIdx] = event;
    } else {
      this.events.push(event);
    }
    this.eventWriteIdx = (this.eventWriteIdx + 1) % EVENT_BUFFER_SIZE;
    if (!this.eventsFull && this.events.length >= EVENT_BUFFER_SIZE) {
      this.eventsFull = true;
    }
  }

  notifyChange(nodeId: string, oldValue: any, newValue: any): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    // Auto-manage ticks when not in test mode
    if (!this.testMode && !this.tickOpen) {
      this.tickOpen = true;
    }

    const eventType: GraphEvent['type'] =
      node.type === 'signal' ? 'signal-change' :
      node.type === 'derived' ? 'derived-recompute' : 'effect-run';

    const event: GraphEvent = {
      type: eventType,
      nodeId,
      tick: this._currentTick,
      oldValue,
      newValue,
    };

    this.pushEvent(event);
    if (this.recording) this.recordWaveform(nodeId, newValue);

    // Track async context for CDC warnings
    if (node.type === 'signal') {
      this.nodeLastSetContext.set(nodeId, this._inAsyncContext ? 'async' : 'sync');
    }

    // CDC warning: check if derived nodes reading this signal are unguarded
    if (node.type === 'signal' && this._inAsyncContext && this.cdcWarningListeners.size > 0) {
      for (const edge of this.edges) {
        if (edge.from === nodeId) {
          const downstream = this.nodes.get(edge.to);
          if (downstream && downstream.type === 'derived') {
            // Check if downstream also reads a guard signal (one set from sync context)
            const hasGuard = downstream.deps.some(dep => {
              const ctx = this.nodeLastSetContext.get(dep);
              return ctx === 'sync' && dep !== nodeId;
            });
            if (!hasGuard) {
              const warning: CdcWarning = {
                type: 'cdc-async-unguarded',
                signalId: nodeId,
                signalName: node.name,
                derivedId: edge.to,
                derivedName: downstream.name,
                tick: this._currentTick,
              };
              for (const listener of this.cdcWarningListeners) {
                listener(warning);
              }
            }
          }
        }
      }
    }

    // Auto-record coverage
    if (this.coverageEnabled) {
      if (typeof newValue === 'boolean') {
        coverage.recordToggle(nodeId, newValue);
      }
      // Auto-record FSM transitions for signals with states metadata
      if (node.metadata?.states && typeof oldValue === 'string' && typeof newValue === 'string') {
        coverage.recordTransition(nodeId, oldValue, newValue);
      }
    }

    // Notify listeners
    for (const listener of this.listeners) {
      listener(event);
    }

    // Auto-close tick when not in test mode
    if (!this.testMode && this.tickOpen) {
      this._currentTick++;
      this.tickOpen = false;
    }
  }

  notifyEffect(nodeId: string): void {
    const event: GraphEvent = {
      type: 'effect-run',
      nodeId,
      tick: this._currentTick,
    };
    this.pushEvent(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  notifyAssertionArmed(nodeId: string): void {
    const event: GraphEvent = {
      type: 'assertion-armed',
      nodeId,
      tick: this._currentTick,
    };
    this.pushEvent(event);
    for (const listener of this.listeners) listener(event);
  }

  notifyAssertionPassed(nodeId: string): void {
    const event: GraphEvent = {
      type: 'assertion-passed',
      nodeId,
      tick: this._currentTick,
    };
    this.pushEvent(event);
    for (const listener of this.listeners) listener(event);
  }

  notifyAssertionFailed(nodeId: string): void {
    const event: GraphEvent = {
      type: 'assertion-failed',
      nodeId,
      tick: this._currentTick,
    };
    this.pushEvent(event);
    for (const listener of this.listeners) listener(event);
  }

  // --- Queries ---

  getNodes(): GraphNode[] {
    return [...this.nodes.values()];
  }

  getEdges(): GraphEdge[] {
    return [...this.edges];
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  getAssertions(): Array<{ id: string; name: string; kind: string; checkFn: () => boolean; deps: string[]; originalCheckFn?: () => boolean }> {
    return [...this.nodes.values()]
      .filter(n => n.type === 'assertion' && n.assertionFn)
      .map(n => ({
        id: n.id,
        name: n.name,
        kind: n.assertionKind ?? 'always',
        checkFn: n.assertionFn!,
        deps: n.deps,
        originalCheckFn: n.metadata?.userCheckFn,
      }));
  }

  checkAssertions(): AssertionViolation[] {
    const violations: AssertionViolation[] = [];
    for (const node of this.nodes.values()) {
      if (node.type === 'assertion' && node.assertionFn && node.assertionKind) {
        const passed = node.assertionFn();
        if (!passed) {
          violations.push({
            nodeId: node.id,
            name: node.name,
            kind: node.assertionKind,
            tick: this._currentTick,
          });
          this.notifyAssertionFailed(node.id);
        } else {
          this.notifyAssertionPassed(node.id);
        }
      }
    }
    return violations;
  }

  getRecentEvents(n = 50): GraphEvent[] {
    if (!this.eventsFull) return this.events.slice(-n);
    const result: GraphEvent[] = [];
    const total = Math.min(n, EVENT_BUFFER_SIZE);
    for (let i = 0; i < total; i++) {
      const idx = (this.eventWriteIdx - 1 - i + EVENT_BUFFER_SIZE) % EVENT_BUFFER_SIZE;
      result.unshift(this.events[idx]);
    }
    return result;
  }

  // --- Subscriptions ---

  subscribe(listener: (event: GraphEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // --- Snapshots & diffing ---

  snapshot(): GraphSnapshot {
    return {
      nodes: this.getNodes().map(n => ({
        id: n.id,
        name: n.name,
        type: n.type,
        deps: n.deps,
      })),
      edges: this.getEdges(),
    };
  }

  static diffGraphs(a: GraphSnapshot, b: GraphSnapshot): GraphDiff {
    const aNodeIds = new Set(a.nodes.map(n => n.name));
    const bNodeIds = new Set(b.nodes.map(n => n.name));
    const aNodeMap = new Map(a.nodes.map(n => [n.name, n]));
    const bNodeMap = new Map(b.nodes.map(n => [n.name, n]));

    const addedNodes: string[] = [];
    const removedNodes: string[] = [];
    const changedNodes: Array<{ id: string; before: any; after: any }> = [];

    for (const name of bNodeIds) {
      if (!aNodeIds.has(name)) {
        addedNodes.push(name);
      } else {
        const aNode = aNodeMap.get(name)!;
        const bNode = bNodeMap.get(name)!;
        if (aNode.type !== bNode.type) {
          changedNodes.push({ id: name, before: aNode, after: bNode });
        }
      }
    }
    for (const name of aNodeIds) {
      if (!bNodeIds.has(name)) {
        removedNodes.push(name);
      }
    }

    const edgeKey = (e: GraphEdge) => `${e.from}->${e.to}`;
    const aEdgeSet = new Set(a.edges.map(edgeKey));
    const bEdgeSet = new Set(b.edges.map(edgeKey));

    const addedEdges = b.edges.filter(e => !aEdgeSet.has(edgeKey(e)));
    const removedEdges = a.edges.filter(e => !bEdgeSet.has(edgeKey(e)));

    return { addedNodes, removedNodes, changedNodes, addedEdges, removedEdges };
  }

  // --- Tick tracking ---

  enterTestMode(): void {
    this.testMode = true;
  }

  openTick(): void {
    this.tickOpen = true;
  }

  closeTick(): void {
    if (this.tickOpen) {
      this._currentTick++;
      this.tickOpen = false;
    }
  }

  exitTestMode(): void {
    this.testMode = false;
  }

  enableCoverage(): void {
    this.coverageEnabled = true;
    coverage.enable();
  }

  disableCoverage(): void {
    this.coverageEnabled = false;
    coverage.disable();
  }

  // --- CDC async context tracking ---

  setAsyncContext(isAsync: boolean): void {
    this._inAsyncContext = isAsync;
  }

  getNodeLastSetContext(nodeId: string): 'sync' | 'async' | undefined {
    return this.nodeLastSetContext.get(nodeId);
  }

  onCdcWarning(listener: (warning: CdcWarning) => void): () => void {
    this.cdcWarningListeners.add(listener);
    return () => { this.cdcWarningListeners.delete(listener); };
  }

  // --- Waveform recording ---

  startRecording(): void {
    this.recording = true;
    this.waveforms.clear();
    const t = this.now();
    for (const [id, node] of this.nodes) {
      if (node.getValue && (node.type === 'signal' || node.type === 'derived')) {
        try {
          const v = node.getValue();
          if (v !== undefined) {
            this.waveforms.set(id, [{ t, v }]);
          }
        } catch (_) { /* getValue may not be ready yet */ }
      }
    }
  }

  stopRecording(): void {
    this.recording = false;
  }

  getWaveformData(): Map<string, Array<{ t: number; v: any }>> {
    return new Map(this.waveforms);
  }

  private recordWaveform(nodeId: string, value: any): void {
    let buf = this.waveforms.get(nodeId);
    if (!buf) {
      buf = [];
      this.waveforms.set(nodeId, buf);
    }
    buf.push({ t: this.now(), v: value });
    if (buf.length > 2000) buf.shift();
  }

  // --- Reset ---

  reset(): void {
    this.nodes.clear();
    this.edges = [];
    this.events = [];
    this.eventWriteIdx = 0;
    this.eventsFull = false;
    this.listeners.clear();
    this.recording = false;
    this.waveforms.clear();
    this._currentTick = 0;
    this.testMode = false;
    this.tickOpen = false;
    this.coverageEnabled = false;
    this._inAsyncContext = false;
    this.nodeLastSetContext.clear();
    this.cdcWarningListeners.clear();
  }
}

/** Default singleton instance for convenience. */
export const graph = new CircuitGraph();
