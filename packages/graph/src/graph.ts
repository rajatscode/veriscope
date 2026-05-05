// graph.ts — CircuitGraph: introspectable reactive dependency graph
// Extracted from Comb's runtime, simplified for framework-agnostic use

import type {
  AssertionMetadata,
  AssertionViolation,
  CdcWarning,
  GraphDiff,
  GraphEdge,
  GraphEvent,
  GraphNode,
  GraphSnapshot,
  NodeType,
  OperationSpan,
  OperationModel,
  OperationStatus,
  WaveformPoint,
} from './types.js';
import { coverage } from './coverage.js';

const EVENT_BUFFER_SIZE = 256;

let idCounter = 0;

export class CircuitGraph {
  private nodes = new Map<string, GraphNode>();
  private edges: GraphEdge[] = [];
  private events: GraphEvent[] = [];
  private eventWriteIdx = 0;
  private eventsFull = false;
  private eventSeq = 0;
  private listeners = new Set<(event: GraphEvent) => void>();
  private recording = false;
  private waveforms = new Map<string, WaveformPoint[]>();
  private disposedNodes = new Map<string, GraphNode>();
  private stablePathCounts = new Map<string, number>();
  private operations = new Map<string, OperationSpan>();
  private operationModels = new Map<string, OperationModel>();
  private operationStack: string[] = [];
  private operationCounter = 0;
  private captureContext: Record<string, any> = {};
  private _currentTick = 0;
  private testMode = false;
  private tickOpen = false;
  private tickCloseScheduled = false;
  private coverageEnabled = false;
  private _inAsyncContext = false;
  private nodeLastSetContext = new Map<string, 'sync' | 'async'>();
  private cdcWarningListeners = new Set<(warning: CdcWarning) => void>();

  /** Current simulation tick (increments on closeTick). */
  get currentTick(): number {
    return this._currentTick;
  }

  // --- Node management ---

  registerNode(info: {
    name: string;
    type: NodeType;
    deps?: string[];
    stablePath?: string;
    metadata?: Record<string, any>;
    assertionMetadata?: AssertionMetadata;
    computeFn?: () => any;
  }): string {
    const id = `${info.name}_${idCounter++}`;
    const stablePath = this.allocateStablePath(info.name, info.stablePath, info.metadata);
    const node: GraphNode = {
      id,
      stablePath,
      name: info.name,
      type: info.type,
      deps: info.deps ?? [],
      getValue: null,
      setValue: null,
      metadata: info.metadata,
      assertionMetadata: info.assertionMetadata,
      computeFn: info.computeFn,
      createdAtTick: this._currentTick,
    };
    this.nodes.set(id, node);

    if (info.computeFn) {
      try {
        node.currentValue = info.computeFn();
        node.hasCurrentValue = true;
      } catch (_) {
        node.hasCurrentValue = false;
      }
      node.getValue = () => {
        if (!node.hasCurrentValue) {
          node.currentValue = node.computeFn!();
          node.hasCurrentValue = true;
        }
        return node.currentValue;
      };
    }

    // Add edges from deps
    if (info.deps) {
      for (const dep of info.deps) {
        this.edges.push({ from: dep, to: id });
      }
    }

    this.emitEvent({
      type: 'node-created',
      nodeId: id,
      stablePath,
      tick: this._currentTick,
      metadata: {
        name: info.name,
        type: info.type,
        deps: info.deps ?? [],
      },
    });

    return id;
  }

  private allocateStablePath(name: string, explicit?: string, metadata?: Record<string, any>): string {
    const base = explicit
      ?? metadata?.stablePath
      ?? (metadata?.scope ? `${metadata.scope}/${name}` : name);
    const count = this.stablePathCounts.get(base) ?? 0;
    this.stablePathCounts.set(base, count + 1);
    return count === 0 ? base : `${base}[${count}]`;
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

  driveNodeValue(id: string, value: any): void {
    const node = this.nodes.get(id);
    if (!node?.setValue) return;

    const oldValue = node.getValue?.();
    const nextValue = typeof value === 'function' ? value(oldValue) : value;
    const beforeEventSeq = this.eventSeq;
    node.setValue(nextValue);
    const newValue = node.getValue?.();

    if (!Object.is(oldValue, newValue) && this.eventSeq === beforeEventSeq) {
      this.notifyChange(id, oldValue, newValue);
    }

    if (!Object.is(oldValue, newValue)) {
      this.propagate(id);
    }
  }

  propagate(fromNodeId?: string): void {
    const candidates = this.collectDownstreamDerivedNodes(fromNodeId);
    const ordered = this.topologicalDerivedOrder(candidates);

    for (const id of ordered) {
      const node = this.nodes.get(id);
      if (!node?.computeFn) continue;

      const oldValue = node.getValue?.();
      const newValue = node.computeFn();
      node.currentValue = newValue;
      node.hasCurrentValue = true;

      if (!Object.is(oldValue, newValue)) {
        this.notifyChange(id, oldValue, newValue);
      }
    }
  }

  private collectDownstreamDerivedNodes(fromNodeId?: string): Set<string> {
    const candidates = new Set<string>();

    if (!fromNodeId) {
      for (const node of this.nodes.values()) {
        if (node.type === 'derived') candidates.add(node.id);
      }
      return candidates;
    }

    const queue = [fromNodeId];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      for (const edge of this.edges) {
        if (edge.from !== current) continue;
        const downstream = this.nodes.get(edge.to);
        if (!downstream) continue;
        if (downstream.type === 'derived') candidates.add(downstream.id);
        queue.push(downstream.id);
      }
    }

    return candidates;
  }

  private topologicalDerivedOrder(candidates: Set<string>): string[] {
    const ids = [...candidates];
    const indegree = new Map(ids.map(id => [id, 0]));
    const children = new Map(ids.map(id => [id, [] as string[]]));

    for (const edge of this.edges) {
      if (!candidates.has(edge.from) || !candidates.has(edge.to)) continue;
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
      children.get(edge.from)?.push(edge.to);
    }

    const queue = ids.filter(id => (indegree.get(id) ?? 0) === 0);
    const ordered: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      ordered.push(id);
      for (const child of children.get(id) ?? []) {
        indegree.set(child, (indegree.get(child) ?? 0) - 1);
        if ((indegree.get(child) ?? 0) === 0) queue.push(child);
      }
    }

    for (const id of ids) {
      if (!ordered.includes(id)) ordered.push(id);
    }

    return ordered;
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

  setAssertionMetadata(id: string, metadata: AssertionMetadata): void {
    const node = this.nodes.get(id);
    if (node) {
      node.assertionMetadata = {
        ...node.assertionMetadata,
        ...metadata,
      };
    }
  }

  getAssertionUserCheckFn(id: string): (() => boolean) | undefined {
    const node = this.nodes.get(id);
    return node?.metadata?.userCheckFn;
  }

  disposeNode(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;

    node.disposedAtTick = this._currentTick;
    this.disposedNodes.set(id, { ...node, deps: [...node.deps] });
    this.markWaveformEnded(id);
    this.edges = this.edges.filter(e => e.from !== id && e.to !== id);
    this.nodes.delete(id);
    this.emitEvent({
      type: 'node-disposed',
      nodeId: id,
      stablePath: node.stablePath,
      tick: this._currentTick,
      metadata: {
        name: node.name,
        type: node.type,
      },
    });
  }

  // --- Event recording (ring buffer) ---

  private now(): number {
    if (typeof performance !== 'undefined') return performance.now();
    return Date.now();
  }

  private pushEvent(event: GraphEvent): void {
    this.eventSeq++;
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

  private emitEvent(event: GraphEvent): void {
    this.pushEvent(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private ensureTickOpen(): void {
    if (!this.tickOpen) {
      this.tickOpen = true;
    }
  }

  private scheduleTickClose(): void {
    if (this.testMode || this.tickCloseScheduled) return;

    this.tickCloseScheduled = true;
    const schedule =
      typeof queueMicrotask === 'function'
        ? queueMicrotask
        : (fn: () => void) => Promise.resolve().then(fn);

    schedule(() => {
      this.tickCloseScheduled = false;
      this.closeTick();
    });
  }

  notifyChange(nodeId: string, oldValue: any, newValue: any): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    if (!this.testMode) {
      this.ensureTickOpen();
      this.scheduleTickClose();
    }

    const eventType: GraphEvent['type'] =
      node.type === 'signal' ? 'signal-change' :
      node.type === 'derived' ? 'derived-recompute' : 'effect-run';

    const event: GraphEvent = {
      type: eventType,
      nodeId,
      stablePath: node.stablePath,
      tick: this._currentTick,
      oldValue,
      newValue,
    };
    this.attachActiveOperation(event);

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
      if (node.type === 'signal' && oldValue !== undefined && !Object.is(oldValue, newValue)) {
        coverage.recordTransition(nodeId, String(oldValue), String(newValue));
      }
    }

    // Notify listeners
    for (const listener of this.listeners) {
      listener(event);
    }

  }

  notifyEffect(nodeId: string): void {
    if (!this.testMode) {
      this.ensureTickOpen();
      this.scheduleTickClose();
    }

    const event: GraphEvent = {
      type: 'effect-run',
      nodeId,
      stablePath: this.nodes.get(nodeId)?.stablePath,
      tick: this._currentTick,
    };
    this.attachActiveOperation(event);
    this.pushEvent(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  notifyAssertionArmed(nodeId: string): void {
    const event: GraphEvent = {
      type: 'assertion-armed',
      nodeId,
      stablePath: this.nodes.get(nodeId)?.stablePath,
      tick: this._currentTick,
    };
    this.attachActiveOperation(event);
    this.pushEvent(event);
    for (const listener of this.listeners) listener(event);
  }

  notifyAssertionPassed(nodeId: string): void {
    const event: GraphEvent = {
      type: 'assertion-passed',
      nodeId,
      stablePath: this.nodes.get(nodeId)?.stablePath,
      tick: this._currentTick,
    };
    this.attachActiveOperation(event);
    this.pushEvent(event);
    for (const listener of this.listeners) listener(event);
  }

  notifyAssertionFailed(nodeId: string): void {
    const event: GraphEvent = {
      type: 'assertion-failed',
      nodeId,
      stablePath: this.nodes.get(nodeId)?.stablePath,
      tick: this._currentTick,
    };
    this.attachActiveOperation(event);
    this.pushEvent(event);
    for (const listener of this.listeners) listener(event);
  }

  // --- External operation spans ---

  registerOperationModel(info: {
    name: string;
    outcomes: OperationStatus[];
    triggerDeps?: string[];
    outputDeps?: string[];
    stablePath?: string;
    metadata?: Record<string, any>;
    handleOutcome?: OperationModel['handleOutcome'];
  }): string {
    const id = this.allocateStablePath(`operation:${info.name}`, info.stablePath, info.metadata);
    const model: OperationModel = {
      id,
      name: info.name,
      outcomes: uniqueOperationStatuses(info.outcomes),
      triggerDeps: info.triggerDeps ? [...info.triggerDeps] : undefined,
      outputDeps: info.outputDeps ? [...info.outputDeps] : undefined,
      metadata: info.metadata,
      handleOutcome: info.handleOutcome,
    };
    this.operationModels.set(id, model);
    coverage.declareOperationOutcomes(info.name, model.outcomes);
    return id;
  }

  getOperationModels(): OperationModel[] {
    return [...this.operationModels.values()].map(model => ({
      ...model,
      outcomes: [...model.outcomes],
      triggerDeps: model.triggerDeps ? [...model.triggerDeps] : undefined,
      outputDeps: model.outputDeps ? [...model.outputDeps] : undefined,
    }));
  }

  beginOperation(name: string, metadata?: Record<string, any>): string {
    if (!this.testMode) {
      this.ensureTickOpen();
      this.scheduleTickClose();
    }

    const id = `${name}_${this.operationCounter++}`;
    const outcomes = metadata?.outcomes ?? metadata?.outcomeDomain;
    if (Array.isArray(outcomes)) {
      coverage.declareOperationOutcomes(name, outcomes.map(String));
    }

    const span: OperationSpan = {
      id,
      name,
      status: 'pending',
      startedAtTick: this._currentTick,
      metadata,
      events: [],
      parentId: this.currentOperationId(),
    };
    this.operations.set(id, span);

    this.emitOperationEvent(span, 'operation-begin', 'pending', metadata);
    return id;
  }

  completeOperationOutcome(id: string, status: OperationStatus, payload?: any): void {
    switch (status) {
      case 'resolved':
        this.resolveOperation(id, payload);
        break;
      case 'rejected':
        this.rejectOperation(id, payload);
        break;
      case 'aborted':
        this.abortOperation(id, payload);
        break;
      case 'timeout':
        this.timeoutOperation(id);
        break;
      case 'stale':
        this.markOperationStale(id, payload?.newerId);
        break;
      case 'pending':
        break;
    }
  }

  resolveOperation(id: string, value?: any): void {
    this.completeOperation(id, 'resolved', 'operation-resolve', { value });
  }

  rejectOperation(id: string, error?: any): void {
    this.completeOperation(id, 'rejected', 'operation-reject', { error });
  }

  abortOperation(id: string, reason?: any): void {
    this.completeOperation(id, 'aborted', 'operation-abort', { reason });
  }

  timeoutOperation(id: string): void {
    this.completeOperation(id, 'timeout', 'operation-timeout');
  }

  markOperationStale(id: string, newerId?: string): void {
    const span = this.operations.get(id);
    if (span) span.staleBecauseOf = newerId;
    this.completeOperation(id, 'stale', 'operation-stale', { newerId });
  }

  withOperation<T>(id: string, fn: () => T): T {
    this.operationStack.push(id);
    try {
      const result = fn();
      if (result && typeof (result as any).then === 'function') {
        return (result as unknown as Promise<any>).finally(() => {
          this.operationStack.pop();
        }) as T;
      }
      this.operationStack.pop();
      return result;
    } catch (err) {
      this.operationStack.pop();
      throw err;
    }
  }

  getOperations(): OperationSpan[] {
    return [...this.operations.values()].map(op => ({
      ...op,
      events: [...op.events],
      metadata: op.metadata ? { ...op.metadata } : undefined,
    }));
  }

  restoreOperations(operations: OperationSpan[]): void {
    this.operations.clear();
    this.operationStack = [];
    let nextCounter = 0;
    for (const operation of operations) {
      const restored: OperationSpan = {
        ...operation,
        metadata: operation.metadata ? { ...operation.metadata } : undefined,
        events: operation.events.map(event => ({ ...event, metadata: event.metadata ? { ...event.metadata } : undefined })),
      };
      this.operations.set(restored.id, restored);
      const suffix = restored.id.match(/_(\d+)$/)?.[1];
      if (suffix !== undefined) nextCounter = Math.max(nextCounter, Number(suffix) + 1);
    }
    this.operationCounter = nextCounter;
  }

  currentOperationId(): string | undefined {
    return this.operationStack[this.operationStack.length - 1];
  }

  private completeOperation(
    id: string,
    status: OperationStatus,
    eventType: GraphEvent['type'],
    metadata?: Record<string, any>,
  ): void {
    if (!this.testMode) {
      this.ensureTickOpen();
      this.scheduleTickClose();
    }

    const span = this.operations.get(id);
    if (!span) return;
    span.status = status;
    span.completedAtTick = this._currentTick;
    if (this.coverageEnabled) {
      coverage.recordOperationOutcome(span.name, status);
    }
    this.emitOperationEvent(span, eventType, status, metadata);
  }

  private emitOperationEvent(
    span: OperationSpan,
    type: GraphEvent['type'],
    status: OperationStatus,
    metadata?: Record<string, any>,
  ): void {
    const event: GraphEvent = {
      type,
      nodeId: `operation:${span.id}`,
      tick: this._currentTick,
      operationId: span.id,
      operationName: span.name,
      status,
      metadata,
    };
    span.events.push(event);
    this.emitEvent(event);
  }

  private attachActiveOperation(event: GraphEvent): void {
    const operationId = this.currentOperationId();
    if (!operationId) return;
    const span = this.operations.get(operationId);
    if (!span) return;
    event.operationId = span.id;
    event.operationName = span.name;
    span.events.push(event);
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

  getAssertions(): Array<{
    id: string;
    name: string;
    kind: string;
    checkFn: () => boolean;
    deps: string[];
    stablePath: string;
    metadata?: AssertionMetadata;
    originalCheckFn?: () => boolean;
  }> {
    return [...this.nodes.values()]
      .filter(n => n.type === 'assertion' && n.assertionFn)
      .map(n => ({
        id: n.id,
        name: n.name,
        kind: n.assertionKind ?? 'always',
        checkFn: n.assertionFn!,
        deps: n.deps,
        stablePath: n.stablePath,
        metadata: n.assertionMetadata,
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

  setCaptureContext(context: Record<string, any>): void {
    this.captureContext = { ...context };
  }

  snapshot(captureContext?: Record<string, any>): GraphSnapshot {
    const nodePath = (id: string) =>
      this.nodes.get(id)?.stablePath
      ?? this.disposedNodes.get(id)?.stablePath
      ?? id;

    return {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      currentTick: this._currentTick,
      captureContext: {
        ...this.captureContext,
        ...captureContext,
      },
      nodes: this.getNodes().map(n => this.snapshotNode(n, nodePath)),
      edges: this.getEdges().map(edge => ({
        from: nodePath(edge.from),
        to: nodePath(edge.to),
      })),
      events: this.getRecentEvents(EVENT_BUFFER_SIZE),
      waveforms: Object.fromEntries(
        [...this.waveforms.entries()].map(([id, points]) => [nodePath(id), points.map(p => ({ ...p }))]),
      ),
      disposedNodes: [...this.disposedNodes.values()].map(n => this.snapshotNode(n, nodePath)),
      operations: this.getOperations(),
      operationModels: this.getOperationModels().map(model => ({
        id: model.id,
        name: model.name,
        outcomes: [...model.outcomes],
        triggerDeps: model.triggerDeps ? [...model.triggerDeps] : undefined,
        outputDeps: model.outputDeps ? [...model.outputDeps] : undefined,
        metadata: this.serializableMetadata(model.metadata),
      })),
    };
  }

  private snapshotNode(n: GraphNode, nodePath: (id: string) => string): GraphSnapshot['nodes'][number] {
    return {
      id: n.stablePath,
      runtimeId: n.id,
      stablePath: n.stablePath,
      name: n.name,
      type: n.type,
      deps: n.deps,
      depPaths: n.deps.map(nodePath),
      metadata: this.serializableMetadata(n.metadata),
      assertionMetadata: n.assertionMetadata,
      createdAtTick: n.createdAtTick,
      disposedAtTick: n.disposedAtTick,
    };
  }

  private serializableMetadata(metadata: Record<string, any> | undefined): Record<string, any> | undefined {
    if (!metadata) return undefined;
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (typeof value === 'function') continue;
      result[key] = value;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  static diffGraphs(a: GraphSnapshot, b: GraphSnapshot): GraphDiff {
    const identity = (n: GraphSnapshot['nodes'][number]) => n.stablePath ?? n.id ?? n.name;
    const aNodeIds = new Set(a.nodes.map(identity));
    const bNodeIds = new Set(b.nodes.map(identity));
    const aNodeMap = new Map(a.nodes.map(n => [identity(n), n]));
    const bNodeMap = new Map(b.nodes.map(n => [identity(n), n]));

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
    this.ensureTickOpen();
  }

  runInTick<T>(fn: () => T): T {
    this.openTick();
    try {
      return fn();
    } finally {
      this.closeTick();
    }
  }

  batch<T>(fn: () => T): T {
    return this.runInTick(fn);
  }

  closeTick(): void {
    if (this.tickOpen) {
      this.checkAssertions();
      this._currentTick++;
      this.tickOpen = false;
      this.tickCloseScheduled = false;
    }
  }

  async flushTick(settle?: () => void | Promise<void>): Promise<void> {
    this.closeTick();
    await Promise.resolve();
    if (settle) await settle();
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
          this.waveforms.set(id, [{ t, v, tick: this._currentTick, lifecycle: 'active' }]);
          }
        } catch (_) { /* getValue may not be ready yet */ }
      }
    }
  }

  stopRecording(): void {
    this.recording = false;
  }

  getWaveformData(): Map<string, WaveformPoint[]> {
    return new Map(this.waveforms);
  }

  private recordWaveform(nodeId: string, value: any): void {
    let buf = this.waveforms.get(nodeId);
    if (!buf) {
      buf = [];
      this.waveforms.set(nodeId, buf);
    }
    buf.push({ t: this.now(), v: value, tick: this._currentTick, lifecycle: 'active' });
    if (buf.length > 2000) buf.shift();
  }

  private markWaveformEnded(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    let buf = this.waveforms.get(nodeId);
    if (!buf) {
      buf = [];
      this.waveforms.set(nodeId, buf);
    }
    let value: any = undefined;
    try {
      value = node?.getValue?.();
    } catch (_) {
      value = undefined;
    }
    buf.push({ t: this.now(), v: value, tick: this._currentTick, lifecycle: 'ended' });
  }

  // --- Reset ---

  reset(): void {
    this.nodes.clear();
    this.edges = [];
    this.events = [];
    this.eventWriteIdx = 0;
    this.eventsFull = false;
    this.eventSeq = 0;
    this.listeners.clear();
    this.recording = false;
    this.waveforms.clear();
    this.disposedNodes.clear();
    this.stablePathCounts.clear();
    this.operations.clear();
    this.operationModels.clear();
    this.operationStack = [];
    this.operationCounter = 0;
    this.captureContext = {};
    this._currentTick = 0;
    this.testMode = false;
    this.tickOpen = false;
    this.tickCloseScheduled = false;
    this.coverageEnabled = false;
    this._inAsyncContext = false;
    this.nodeLastSetContext.clear();
    this.cdcWarningListeners.clear();
  }
}

function uniqueOperationStatuses(statuses: OperationStatus[]): OperationStatus[] {
  const result: OperationStatus[] = [];
  for (const status of statuses) {
    if (!result.includes(status)) result.push(status);
  }
  return result;
}

/** Default singleton instance for convenience. */
export const graph = new CircuitGraph();
