// operators.ts — Mutation operators for reactive graphs

import type { CircuitGraph, GraphNode, NodeType } from '@veriscope/graph';
import type { Mutation } from './types.js';

interface NodeRef {
  id: string;
  stablePath: string;
  name: string;
  type: NodeType;
}

function refFor(node: GraphNode): NodeRef {
  return {
    id: node.id,
    stablePath: node.stablePath,
    name: node.name,
    type: node.type,
  };
}

function labelFor(ref: NodeRef): string {
  return ref.stablePath || ref.name || ref.id;
}

function findNode(graph: CircuitGraph, ref: NodeRef): GraphNode | undefined {
  return graph.getNode(ref.id)
    ?? graph.getNodes().find(node => node.stablePath === ref.stablePath)
    ?? graph.getNodes().find(node => node.name === ref.name && node.type === ref.type);
}

function mutation(
  info: Omit<Mutation, 'operator' | 'category' | 'targetIds'> & {
    operator: NonNullable<Mutation['operator']>;
    category?: NonNullable<Mutation['category']>;
    targetIds?: string[];
  },
): Mutation {
  return {
    category: 'semantic',
    ...info,
  };
}

/**
 * Generate all possible mutations for a reactive graph.
 * Three operator classes:
 * - sever-edge: break a dependency by replacing source with default value
 * - negate: flip a boolean signal
 * - constant-fold: replace a derived node with a constant
 */
export function generateMutations(graph: CircuitGraph): Mutation[] {
  const mutations: Mutation[] = [];
  const nodes = graph.getNodes();
  const edges = graph.getEdges();

  // Sever edge: for each edge, create a mutation that shadows the source
  for (const edge of edges) {
    const sourceNode = graph.getNode(edge.from);
    if (sourceNode?.getValue) {
      const targetNode = graph.getNode(edge.to);
      const sourceRef = refFor(sourceNode);
      const targetRef = targetNode ? refFor(targetNode) : sourceRef;
      mutations.push(mutation({
        operator: 'sever-edge',
        category: 'structural',
        targetIds: [sourceNode.id, edge.to],
        name: `sever-edge:${labelFor(sourceRef)}->${labelFor(targetRef)}`,
        description: `Sever dependency from ${sourceNode.name} to ${targetNode?.name ?? edge.to}`,
        apply: (g) => {
          const node = findNode(g, sourceRef);
          const original = node?.getValue;
          if (!node || !original) return () => {};
          const currentVal = original();
          const defaultVal = typeof currentVal === 'boolean' ? false : 0;
          g.setNodeValue(node.id, () => defaultVal);
          return () => g.setNodeValue(node.id, original);
        },
      }));
    }
  }

  // Negate boolean: for each boolean signal
  for (const node of nodes) {
    if (node.type === 'signal' && node.getValue) {
      const val = node.getValue();
      if (typeof val === 'boolean') {
        const nodeRef = refFor(node);
        mutations.push(mutation({
          operator: 'negate',
          targetIds: [node.id],
          name: `negate:${labelFor(nodeRef)}`,
          description: `Negate boolean signal ${node.name}`,
          apply: (g) => {
            const n = findNode(g, nodeRef);
            const originalGetter = n?.getValue;
            const originalSetter = n?.setValue;
            if (!n || !originalGetter || !originalSetter) return () => {};
            g.setNodeValue(n.id, () => !originalGetter());
            g.setNodeSetter(n.id, (next: any) => {
              const current = originalGetter();
              const resolved = typeof next === 'function' ? next(current) : next;
              originalSetter(!resolved);
            });
            return () => {
              g.setNodeValue(n.id, originalGetter);
              g.setNodeSetter(n.id, originalSetter);
            };
          },
        }));
      }
    }
  }

  // Constant-fold derived: for each derived value
  for (const node of nodes) {
    if (node.type === 'derived' && node.getValue) {
      const val = node.getValue();
      const constant = typeof val === 'boolean' ? !val : 0;
      const nodeRef = refFor(node);
      mutations.push(mutation({
        operator: 'constant-fold',
        targetIds: [node.id],
        name: `constant-fold:${labelFor(nodeRef)}`,
        description: `Replace ${node.name} with constant ${constant}`,
        apply: (g) => {
          const n = findNode(g, nodeRef);
          const original = n?.getValue;
          const originalCompute = n?.computeFn;
          if (!n || !original) return () => {};
          g.setNodeValue(n.id, () => constant);
          n.computeFn = () => constant;
          n.currentValue = constant;
          n.hasCurrentValue = true;
          g.propagate(n.id);
          return () => {
            g.setNodeValue(n.id, original);
            n.computeFn = originalCompute;
            n.hasCurrentValue = false;
            g.propagate(n.id);
          };
        },
      }));
    }
  }

  // Swap edge: for each pair of same-type signals, make one read the other's value
  const signalNodes = nodes.filter(n => n.type === 'signal' && n.getValue);
  for (let i = 0; i < signalNodes.length; i++) {
    for (let j = i + 1; j < signalNodes.length; j++) {
      const a = signalNodes[i];
      const b = signalNodes[j];
      const aVal = a.getValue!();
      const bVal = b.getValue!();
      if (typeof aVal === typeof bVal) {
        const aRef = refFor(a);
        const bRef = refFor(b);
        mutations.push(mutation({
          operator: 'swap-edge',
          category: 'structural',
          targetIds: [a.id, b.id],
          name: `swap-edge:${labelFor(aRef)}<->${labelFor(bRef)}`,
          description: `Swap signal ${a.name} to read ${b.name}'s value`,
          apply: (g) => {
            const na = findNode(g, aRef);
            const nb = findNode(g, bRef);
            const originalA = na?.getValue;
            if (!na || !nb?.getValue || !originalA) return () => {};
            const bGetter = nb.getValue!;
            g.setNodeValue(na.id, bGetter);
            return () => g.setNodeValue(na.id, originalA);
          },
        }));
      }
    }
  }

  // Skip effect: for each effect node, wrap its action with a no-op
  for (const node of nodes) {
    if (node.type === 'effect') {
      const nodeRef = refFor(node);
      mutations.push(mutation({
        operator: 'skip-effect',
        category: 'effect',
        targetIds: [node.id],
        name: `skip-effect:${labelFor(nodeRef)}`,
        description: `Skip effect ${node.name} (replace with no-op)`,
        apply: (g) => {
          const n = findNode(g, nodeRef);
          const original = n?.getValue;
          if (!n || !original) return () => {};
          g.setNodeValue(n.id, () => {});
          return () => g.setNodeValue(n.id, original);
        },
      }));
    }
  }

  // Invert comparison: for each derived node returning boolean, negate its compute
  for (const node of nodes) {
    if (node.type === 'derived' && node.getValue) {
      const val = node.getValue();
      if (typeof val === 'boolean') {
        const nodeRef = refFor(node);
        mutations.push(mutation({
          operator: 'invert-comparison',
          targetIds: [node.id],
          name: `invert-comparison:${labelFor(nodeRef)}`,
          description: `Invert boolean derived ${node.name}`,
          apply: (g) => {
            const n = findNode(g, nodeRef);
            const original = n?.getValue;
            const originalCompute = n?.computeFn;
            if (!n || !original) return () => {};
            const readOriginal = originalCompute ? () => originalCompute() : original;
            g.setNodeValue(n.id, () => !readOriginal());
            n.computeFn = () => !readOriginal();
            n.hasCurrentValue = false;
            g.propagate(n.id);
            return () => {
              g.setNodeValue(n.id, original);
              n.computeFn = originalCompute;
              n.hasCurrentValue = false;
              g.propagate(n.id);
            };
          },
        }));
      }
    }
  }

  // Remove assertion: for each assertion node, disable it
  for (const node of nodes) {
    if (node.type === 'assertion') {
      const nodeRef = refFor(node);
      mutations.push(mutation({
        operator: 'remove-assertion',
        category: 'meta',
        targetIds: [node.id],
        name: `remove-assertion:${labelFor(nodeRef)}`,
        description: `Disable assertion ${node.name}`,
        apply: (g) => {
          const n = findNode(g, nodeRef);
          const originalFn = n?.assertionFn;
          const originalKind = n?.assertionKind;
          if (!n || !originalFn) return () => {};
          // Disable by making it always pass
          g.setAssertionFn(n.id, () => true, originalKind ?? 'always');
          return () => g.setAssertionFn(n.id, originalFn, originalKind ?? 'always');
        },
      }));
    }
  }

  // Delay effect: for each effect, queue its action to fire on next tick
  for (const node of nodes) {
    if (node.type === 'effect') {
      const nodeRef = refFor(node);
      mutations.push(mutation({
        operator: 'delay-effect',
        category: 'effect',
        targetIds: [node.id],
        name: `delay-effect:${labelFor(nodeRef)}`,
        description: `Delay effect ${node.name} to next tick`,
        apply: (g) => {
          const n = findNode(g, nodeRef);
          const original = n?.getValue;
          if (!n || !original) return () => {};
          g.setNodeValue(n.id, () => {
            setTimeout(() => original(), 0);
          });
          return () => g.setNodeValue(n.id, original);
        },
      }));
    }
  }

  return mutations;
}
