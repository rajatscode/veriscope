export interface ReadonlySignal<T> {
  readonly val: T;
  readonly nodeId: string;
  readonly name: string;
}

export interface Signal<T> extends ReadonlySignal<T> {
  set(next: T | ((prev: T) => T)): void;
}

export type NodeType = 'signal' | 'derived' | 'effect' | 'assertion';
export type OperationStatus = 'pending' | 'resolved' | 'rejected' | 'aborted' | 'timeout' | 'stale';

export interface AssertionMetadata {
  triggerDeps?: string[];
  checkDeps?: string[];
  edge?: 'posedge' | 'negedge';
  temporalOperator?: 'immediately' | 'eventually' | 'withinTicks';
  domains?: Record<string, any[]>;
  operationDomains?: Record<string, string[]>;
  partial?: boolean;
  reason?: string;
}

export interface GraphNode {
  id: string;
  stablePath: string;
  name: string;
  type: NodeType;
  deps: string[];
  getValue: (() => any) | null;
  setValue: ((v: any) => void) | null;
  computeFn?: () => any;
  currentValue?: any;
  hasCurrentValue?: boolean;
  assertionFn?: () => boolean;
  assertionKind?: 'always' | 'never' | 'after';
  metadata?: Record<string, any>;
  assertionMetadata?: AssertionMetadata;
  createdAtTick: number;
  disposedAtTick?: number;
  trigger?: { element: string; action: 'click' | 'type' | 'select'; value?: string };
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface WaveformPoint {
  t: number;
  v: any;
  tick?: number;
  lifecycle?: 'active' | 'ended';
}

export interface OperationSpan {
  id: string;
  name: string;
  status: OperationStatus;
  startedAtTick: number;
  completedAtTick?: number;
  inputDeps?: string[];
  inputDepPaths?: string[];
  outputDeps?: string[];
  outputDepPaths?: string[];
  metadata?: Record<string, any>;
  events: GraphEvent[];
  parentId?: string;
  staleBecauseOf?: string;
}

export interface OperationModelContext {
  graph: any;
  operationId: string;
  model: OperationModel;
}

export interface OperationModel {
  id: string;
  name: string;
  outcomes: OperationStatus[];
  triggerDeps?: string[];
  outputDeps?: string[];
  metadata?: Record<string, any>;
  handleOutcome?: (outcome: OperationStatus, context: OperationModelContext) => void | Promise<void>;
}

export interface GraphEvent {
  seq?: number;
  type:
    | 'node-created'
    | 'node-disposed'
    | 'graph-reset'
    | 'signal-change'
    | 'derived-recompute'
    | 'effect-run'
    | 'assertion-armed'
    | 'assertion-passed'
    | 'assertion-failed'
    | 'operation-begin'
    | 'operation-resolve'
    | 'operation-reject'
    | 'operation-abort'
    | 'operation-timeout'
    | 'operation-stale';
  nodeId: string;
  tick: number;
  oldValue?: any;
  newValue?: any;
  stablePath?: string;
  operationId?: string;
  operationName?: string;
  status?: OperationStatus;
  metadata?: Record<string, any>;
}

export interface GraphSnapshot {
  schemaVersion?: 1;
  capturedAt?: string;
  currentTick?: number;
  captureContext?: Record<string, any>;
  nodes: Array<{
    id: string;
    runtimeId?: string;
    stablePath?: string;
    name: string;
    type: string;
    deps: string[];
    depPaths?: string[];
    metadata?: Record<string, any>;
    assertionMetadata?: AssertionMetadata;
    createdAtTick?: number;
    disposedAtTick?: number;
  }>;
  edges: GraphEdge[];
  events?: GraphEvent[];
  waveforms?: Record<string, WaveformPoint[]>;
  disposedNodes?: Array<{
    id: string;
    runtimeId?: string;
    stablePath?: string;
    name: string;
    type: string;
    deps: string[];
    metadata?: Record<string, any>;
    assertionMetadata?: AssertionMetadata;
    createdAtTick?: number;
    disposedAtTick?: number;
  }>;
  operations?: OperationSpan[];
  operationModels?: Array<{
    id: string;
    name: string;
    outcomes: OperationStatus[];
    triggerDeps?: string[];
    outputDeps?: string[];
    metadata?: Record<string, any>;
  }>;
}

export interface GraphDiff {
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: Array<{ id: string; before: any; after: any }>;
  addedEdges: GraphEdge[];
  removedEdges: GraphEdge[];
}

export interface AssertionViolation {
  nodeId: string;
  name: string;
  kind: 'always' | 'never' | 'after';
  tick: number;
}

export interface CdcWarning {
  type: 'cdc-async-unguarded';
  signalId: string;
  signalName: string;
  derivedId: string;
  derivedName: string;
  tick: number;
}
