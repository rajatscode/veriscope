// visualizer.ts — Graph visualizer: nodes as colored boxes, edges as lines
// Simple force-directed-ish layout without external dependencies

import type { CircuitGraph, GraphEdge, GraphEvent, GraphNode } from '@veriscope/graph';

const NODE_COLORS: Record<string, string> = {
  signal: '#6ee7f9',
  derived: '#a78bfa',
  effect: '#72f1b8',
  assertion: '#ff5d8f',
};

const NODE_W = 168;
const NODE_H = 50;
const PADDING = 40;
const PLAYER_GROUP_THRESHOLD = 80;
const MIN_DRAW_INTERVAL_MS = 120;
const PLAYER_METRIC_RE = /^p\d+\.(score|lines|pendingGarbage|lastSent|lastReceived|stackHeight|alive|ko|piece)$/;

interface LayoutNode {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  deps: string[];
  memberIds?: string[];
}

interface DisplayNode {
  id: string;
  name: string;
  type: string;
  deps: string[];
  memberIds?: string[];
}

interface DisplayModel {
  nodes: DisplayNode[];
  edges: GraphEdge[];
  groupedMembers: number;
}

interface VisualizerOptions {
  isActive?: () => boolean;
  maxFps?: number;
}

function compactText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}\u2026` : value;
}

function formatNodeValue(value: unknown): string {
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') return '{...}';
  if (typeof value === 'function') return 'fn';
  return String(value);
}

function displayModel(graph: CircuitGraph): DisplayModel {
  const nodes = graph.getNodes();
  const edges = graph.getEdges();

  if (nodes.length < PLAYER_GROUP_THRESHOLD) {
    return {
      nodes: nodes.map(node => ({
        id: node.id,
        name: node.name,
        type: node.type,
        deps: node.deps,
      })),
      edges,
      groupedMembers: 0,
    };
  }

  const groupByPlayer = new Map<string, GraphNode[]>();
  const groupedNodeIds = new Set<string>();
  for (const node of nodes) {
    if (!PLAYER_METRIC_RE.test(node.name)) continue;
    const playerId = node.name.split('.')[0];
    const group = groupByPlayer.get(playerId) ?? [];
    group.push(node);
    groupByPlayer.set(playerId, group);
    groupedNodeIds.add(node.id);
  }

  if (groupByPlayer.size === 0) {
    return {
      nodes: nodes.map(node => ({
        id: node.id,
        name: node.name,
        type: node.type,
        deps: node.deps,
      })),
      edges,
      groupedMembers: 0,
    };
  }

  const groupIdByNode = new Map<string, string>();
  const displayNodes: DisplayNode[] = [];
  let groupedMembers = 0;

  for (const node of nodes) {
    if (groupedNodeIds.has(node.id)) continue;
    displayNodes.push({
      id: node.id,
      name: node.name,
      type: node.type,
      deps: node.deps,
    });
  }

  for (const [playerId, members] of groupByPlayer) {
    const groupId = `group:${playerId}`;
    groupedMembers += members.length;
    for (const member of members) groupIdByNode.set(member.id, groupId);
    displayNodes.push({
      id: groupId,
      name: `${playerId}.metrics`,
      type: 'derived',
      deps: unique(members.flatMap(member => member.deps).map(id => groupIdByNode.get(id) ?? id).filter(id => id !== groupId)),
      memberIds: members.map(member => member.id),
    });
  }

  const displayEdges: GraphEdge[] = [];
  const seenEdges = new Set<string>();
  for (const edge of edges) {
    const from = groupIdByNode.get(edge.from) ?? edge.from;
    const to = groupIdByNode.get(edge.to) ?? edge.to;
    if (from === to) continue;
    const key = `${from}->${to}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    displayEdges.push({ from, to });
  }

  return { nodes: displayNodes, edges: displayEdges, groupedMembers };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function layoutNodes(model: DisplayModel): LayoutNode[] {
  const nodes = model.nodes;
  const edges = model.edges;

  // Separate assertion nodes from the rest
  const assertionIds = new Set(nodes.filter(n => n.type === 'assertion').map(n => n.id));
  const nonAssertionNodes = nodes.filter(n => !assertionIds.has(n.id));
  const assertionNodes = nodes.filter(n => assertionIds.has(n.id));

  // Topological layering for non-assertion nodes
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const n of nonAssertionNodes) {
    inDegree.set(n.id, 0);
    children.set(n.id, []);
  }
  for (const e of edges) {
    // Only consider edges between non-assertion nodes
    if (assertionIds.has(e.to) || assertionIds.has(e.from)) continue;
    if (inDegree.has(e.to)) {
      inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    }
    if (children.has(e.from)) {
      children.get(e.from)!.push(e.to);
    }
  }

  const layers: string[][] = [];
  const assigned = new Set<string>();
  const remaining = new Set(nonAssertionNodes.map(n => n.id));

  while (remaining.size > 0) {
    const layer: string[] = [];
    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) <= 0) {
        layer.push(id);
      }
    }
    if (layer.length === 0) {
      // Cycle — just take remaining
      layer.push(...remaining);
      remaining.clear();
    }
    for (const id of layer) {
      remaining.delete(id);
      assigned.add(id);
      for (const child of (children.get(id) ?? [])) {
        inDegree.set(child, (inDegree.get(child) ?? 0) - 1);
      }
    }
    layers.push(layer);
  }

  // Position nodes in layers, with assertions in the rightmost column
  const layoutNodes: LayoutNode[] = [];
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
    const layer = layers[layerIdx];
    const layerX = PADDING + layerIdx * (NODE_W + 60);
    for (let i = 0; i < layer.length; i++) {
      const nodeId = layer[i];
      const node = nodeMap.get(nodeId);
      if (!node) continue;
      layoutNodes.push({
        id: node.id,
        name: node.name,
        type: node.type,
        x: layerX,
        y: PADDING + i * (NODE_H + 20),
        deps: node.deps,
        memberIds: node.memberIds,
      });
    }
  }

  // Place assertion nodes in the rightmost column
  if (assertionNodes.length > 0) {
    const rightmostX = layers.length > 0 ?
      PADDING + (layers.length) * (NODE_W + 60) :
      PADDING;

    for (let i = 0; i < assertionNodes.length; i++) {
      const node = assertionNodes[i];
      layoutNodes.push({
        id: node.id,
        name: node.name,
        type: node.type,
        x: rightmostX,
        y: PADDING + i * (NODE_H + 20),
        deps: node.deps,
        memberIds: node.memberIds,
      });
    }
  }

  return layoutNodes;
}

export function createVisualizerPanel(
  container: HTMLElement,
  graph: CircuitGraph,
  options?: VisualizerOptions,
): { dispose: () => void; refresh: () => void } {
  container.style.cssText = 'position:relative; overflow:auto; height:100%;';

  const status = document.createElement('div');
  status.style.cssText = 'position:sticky; top:0; left:0; z-index:2; display:none; padding:5px 8px; background:rgba(13,17,23,0.9); border-bottom:1px solid #21262d; color:#8b949e; font:11px "SF Mono","Fira Code",monospace;';
  container.appendChild(status);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;';
  container.appendChild(canvas);

  // Tooltip
  const tip = document.createElement('div');
  tip.style.cssText = 'display:none; position:absolute; background:rgba(13,17,23,0.95); color:#c9d1d9; padding:4px 8px; border-radius:4px; font-size:0.75rem; font-family:"SF Mono",monospace; pointer-events:none; z-index:10; border:1px solid #30363d;';
  container.appendChild(tip);

  let disposed = false;
  let layoutResult: LayoutNode[] = [];
  let displayEdges: GraphEdge[] = [];
  let groupedMembers = 0;
  let layoutDirty = true;
  let frameRequested = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastDrawAt = 0;
  let pendingWhileInactive = false;
  const minDrawInterval = Math.max(16, Math.floor(1000 / (options?.maxFps ?? Math.round(1000 / MIN_DRAW_INTERVAL_MS))));

  function isActive() {
    return options?.isActive ? options.isActive() : true;
  }

  function scheduleDraw(forceLayout = false) {
    if (disposed) return;
    if (forceLayout) layoutDirty = true;
    if (!isActive()) {
      pendingWhileInactive = true;
      return;
    }
    if (frameRequested || timer) return;
    if (forceLayout) {
      requestFrame();
      return;
    }
    const delay = Math.max(0, minDrawInterval - (Date.now() - lastDrawAt));
    timer = setTimeout(() => {
      timer = null;
      requestFrame();
    }, delay);
  }

  function requestFrame() {
    if (disposed || frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(() => {
      frameRequested = false;
      draw();
    });
  }

  function draw() {
    if (disposed || !isActive()) {
      pendingWhileInactive = true;
      return;
    }
    lastDrawAt = Date.now();
    pendingWhileInactive = false;
    if (layoutDirty) {
      const model = displayModel(graph);
      layoutResult = layoutNodes(model);
      displayEdges = model.edges;
      groupedMembers = model.groupedMembers;
      layoutDirty = false;
    }

    // Compute canvas size
    let maxX = 0, maxY = 0;
    for (const n of layoutResult) {
      if (n.x + NODE_W + PADDING > maxX) maxX = n.x + NODE_W + PADDING;
      if (n.y + NODE_H + PADDING > maxY) maxY = n.y + NODE_H + PADDING;
    }
    maxX = Math.max(maxX, 400);
    maxY = Math.max(maxY, 200);

    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.ceil(maxX * dpr);
    const pixelHeight = Math.ceil(maxY * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    canvas.style.width = `${maxX}px`;
    canvas.style.height = `${maxY}px`;
    status.style.display = groupedMembers > 0 ? 'block' : 'none';
    status.textContent = groupedMembers > 0
      ? `Grouped ${groupedMembers} repeated player metric nodes. Hover a player metrics node for values.`
      : '';

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, maxX, maxY);

    // Background
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, maxX, maxY);

    const nodePositions = new Map<string, { x: number; y: number }>();
    for (const n of layoutResult) {
      nodePositions.set(n.id, { x: n.x, y: n.y });
    }

    // Draw edges
    ctx.lineWidth = 1;
    for (const edge of displayEdges) {
      const from = nodePositions.get(edge.from);
      const to = nodePositions.get(edge.to);
      if (!from || !to) continue;

      ctx.strokeStyle = 'rgba(110,231,249,0.25)';
      ctx.beginPath();
      const x1 = from.x + NODE_W;
      const y1 = from.y + NODE_H / 2;
      const x2 = to.x;
      const y2 = to.y + NODE_H / 2;
      ctx.moveTo(x1, y1);
      // Bezier curve for visual clarity
      const cp = (x2 - x1) * 0.4;
      ctx.bezierCurveTo(x1 + cp, y1, x2 - cp, y2, x2, y2);
      ctx.stroke();

      // Arrow head
      const angle = Math.atan2(y2 - (y2 - (y2 - y1) * 0.1), x2 - (x2 - cp));
      ctx.fillStyle = 'rgba(110,231,249,0.4)';
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - 8 * Math.cos(angle - 0.3), y2 - 8 * Math.sin(angle - 0.3));
      ctx.lineTo(x2 - 8 * Math.cos(angle + 0.3), y2 - 8 * Math.sin(angle + 0.3));
      ctx.closePath();
      ctx.fill();
    }

    // Draw nodes
    for (const n of layoutResult) {
      const color = NODE_COLORS[n.type] ?? '#c9d1d9';

      // Box
      ctx.fillStyle = '#161b22';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const r = 4;
      ctx.moveTo(n.x + r, n.y);
      ctx.lineTo(n.x + NODE_W - r, n.y);
      ctx.arcTo(n.x + NODE_W, n.y, n.x + NODE_W, n.y + r, r);
      ctx.lineTo(n.x + NODE_W, n.y + NODE_H - r);
      ctx.arcTo(n.x + NODE_W, n.y + NODE_H, n.x + NODE_W - r, n.y + NODE_H, r);
      ctx.lineTo(n.x + r, n.y + NODE_H);
      ctx.arcTo(n.x, n.y + NODE_H, n.x, n.y + NODE_H - r, r);
      ctx.lineTo(n.x, n.y + r);
      ctx.arcTo(n.x, n.y, n.x + r, n.y, r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Type badge
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.15;
      ctx.fillRect(n.x + 1, n.y + 1, NODE_W - 2, NODE_H - 2);
      ctx.globalAlpha = 1;

      // Label and current value. Showing values in-canvas makes graph redraws
      // visibly live without requiring hover/tooltips.
      ctx.fillStyle = color;
      ctx.font = '11px "SF Mono", "Fira Code", monospace';
      ctx.textBaseline = 'alphabetic';
      const displayName = compactText(n.name, 21);
      ctx.fillText(displayName, n.x + 6, n.y + 17);

      const valueText = compactText(formatLayoutNodeValue(graph, n), 24);
      if (valueText) {
        ctx.fillStyle = 'rgba(201,209,217,0.78)';
        ctx.font = '10px "SF Mono", "Fira Code", monospace';
        ctx.fillText(valueText, n.x + 6, n.y + 34);
      }

      // Type indicator (small text)
      ctx.fillStyle = 'rgba(154,168,189,0.5)';
      ctx.font = '8px system-ui';
      ctx.textAlign = 'right';
      ctx.fillText(n.type, n.x + NODE_W - 4, n.y + NODE_H - 6);
      ctx.textAlign = 'left';
    }
  }

  // Mouse hover tooltip
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let found: LayoutNode | null = null;
    for (const n of layoutResult) {
      if (mx >= n.x && mx <= n.x + NODE_W && my >= n.y && my <= n.y + NODE_H) {
        found = n;
        break;
      }
    }

    if (found) {
      const valueStr = formatTooltipValue(graph, found);
      tip.textContent = `${found.name} (${found.type})${valueStr}\nDeps: ${found.deps.length}`;
      tip.style.display = 'block';
      tip.style.left = `${mx + 12}px`;
      tip.style.top = `${my + 12}px`;
      tip.style.whiteSpace = 'pre';
    } else {
      tip.style.display = 'none';
    }
  });

  canvas.addEventListener('mouseleave', () => { tip.style.display = 'none'; });

  const unsubscribe = graph.subscribe((event: GraphEvent) => {
    if (
      event.type === 'node-created' ||
      event.type === 'node-disposed'
    ) {
      scheduleDraw(true);
    } else if (
      event.type === 'signal-change' ||
      event.type === 'derived-recompute' ||
      event.type === 'effect-run' ||
      event.type === 'assertion-armed' ||
      event.type === 'assertion-passed' ||
      event.type === 'assertion-failed'
    ) {
      scheduleDraw(false);
    }
  });

  draw();

  return {
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      container.innerHTML = '';
    },
    refresh() {
      if (pendingWhileInactive || layoutDirty || isActive()) {
        draw();
      }
    },
  };
}

function formatLayoutNodeValue(graph: CircuitGraph, node: LayoutNode): string {
  if (node.memberIds) {
    const memberByMetric = new Map<string, GraphNode>();
    for (const memberId of node.memberIds) {
      const member = graph.getNode(memberId);
      if (!member) continue;
      const metric = member.name.split('.')[1];
      if (metric) memberByMetric.set(metric, member);
    }
    const score = memberByMetric.get('score')?.getValue?.();
    const lines = memberByMetric.get('lines')?.getValue?.();
    const queue = memberByMetric.get('pendingGarbage')?.getValue?.();
    const ko = memberByMetric.get('ko')?.getValue?.();
    return `S ${formatNodeValue(score)} L ${formatNodeValue(lines)} Q ${formatNodeValue(queue)} ${ko ? 'KO' : 'live'}`;
  }

  const graphNode = graph.getNode(node.id);
  if (!graphNode?.getValue) return '';
  try {
    return formatNodeValue(graphNode.getValue());
  } catch (_) {
    return 'unreadable';
  }
}

function formatTooltipValue(graph: CircuitGraph, node: LayoutNode): string {
  if (node.memberIds) {
    const lines: string[] = [];
    for (const memberId of node.memberIds) {
      const member = graph.getNode(memberId);
      if (!member?.getValue) continue;
      try {
        lines.push(`${member.name}: ${formatNodeValue(member.getValue())}`);
      } catch (_) {
        lines.push(`${member.name}: unreadable`);
      }
    }
    return lines.length > 0 ? `\n${lines.join('\n')}` : '';
  }

  const graphNode = graph.getNode(node.id);
  if (!graphNode?.getValue) return '';
  try {
    return `\nValue: ${JSON.stringify(graphNode.getValue())}`;
  } catch (_) {
    return '\nValue: unreadable';
  }
}
