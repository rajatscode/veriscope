export interface ReadonlySignal<T> {
  readonly val: T;
  readonly nodeId: string;
  readonly name: string;
}

export interface Signal<T> extends ReadonlySignal<T> {
  set(next: T): void;
}

export type NodeType = 'signal' | 'derived' | 'effect' | 'assertion';

export interface GraphNode {
  id: string;
  name: string;
  type: NodeType;
  deps: string[];
  getValue: (() => any) | null;
  setValue: ((v: any) => void) | null;
  assertionFn?: () => boolean;
  assertionKind?: 'always' | 'never' | 'after';
  metadata?: Record<string, any>;
  trigger?: { element: string; action: 'click' | 'type' | 'select'; value?: string };
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface GraphEvent {
  type: 'signal-change' | 'derived-recompute' | 'effect-run' | 'assertion-armed' | 'assertion-passed' | 'assertion-failed';
  nodeId: string;
  tick: number;
  oldValue?: any;
  newValue?: any;
}

export interface GraphSnapshot {
  nodes: Array<{ id: string; name: string; type: string; deps: string[] }>;
  edges: GraphEdge[];
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
