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
const ACTIVITY_TTL_MS = 1400;
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
  displayIdByNodeId: Map<string, string>;
}

interface VisualizerOptions {
  isActive?: () => boolean;
  maxFps?: number;
}

interface ActivityPulse {
  expiresAt: number;
  tick: number;
  color: string;
  label: string;
}

interface FlowSelection {
  selected: string;
  upstreamNodes: Set<string>;
  downstreamNodes: Set<string>;
  upstreamEdges: Set<string>;
  downstreamEdges: Set<string>;
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

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

function displayModel(graph: CircuitGraph): DisplayModel {
  const nodes = graph.getNodes();
  const edges = graph.getEdges();
  const identityMap = new Map(nodes.map(node => [node.id, node.id]));

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
      displayIdByNodeId: identityMap,
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
      displayIdByNodeId: identityMap,
    };
  }

  const groupIdByNode = new Map<string, string>();
  const displayNodes: DisplayNode[] = [];
  let groupedMembers = 0;

  for (const node of nodes) {
    if (groupedNodeIds.has(node.id)) continue;
    groupIdByNode.set(node.id, node.id);
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

  return { nodes: displayNodes, edges: displayEdges, groupedMembers, displayIdByNodeId: groupIdByNode };
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
  let displayIdByNodeId = new Map<string, string>();
  let groupedMembers = 0;
  let layoutDirty = true;
  let frameRequested = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastDrawAt = 0;
  let pendingWhileInactive = false;
  let lastEventLabel = 'idle';
  const nodeActivity = new Map<string, ActivityPulse>();
  const edgeActivity = new Map<string, ActivityPulse>();
  const minDrawInterval = Math.max(16, Math.floor(1000 / (options?.maxFps ?? Math.round(1000 / MIN_DRAW_INTERVAL_MS))));
  let selectedDisplayId: string | null = null;

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

  function displayId(rawNodeId: string): string {
    return displayIdByNodeId.get(rawNodeId) ?? rawNodeId;
  }

  function edgeKey(from: string, to: string): string {
    return `${from}->${to}`;
  }

  function findNodeAt(mx: number, my: number): LayoutNode | null {
    for (const n of layoutResult) {
      if (mx >= n.x && mx <= n.x + NODE_W && my >= n.y && my <= n.y + NODE_H) {
        return n;
      }
    }
    return null;
  }

  function computeFlowSelection(selected: string | null): FlowSelection | null {
    if (!selected) return null;
    const upstreamNodes = new Set<string>();
    const downstreamNodes = new Set<string>();
    const upstreamEdges = new Set<string>();
    const downstreamEdges = new Set<string>();

    const upstreamQueue = [selected];
    while (upstreamQueue.length > 0) {
      const current = upstreamQueue.shift()!;
      for (const edge of displayEdges) {
        if (edge.to !== current || upstreamNodes.has(edge.from)) continue;
        upstreamNodes.add(edge.from);
        upstreamEdges.add(edgeKey(edge.from, edge.to));
        upstreamQueue.push(edge.from);
      }
    }

    const downstreamQueue = [selected];
    while (downstreamQueue.length > 0) {
      const current = downstreamQueue.shift()!;
      for (const edge of displayEdges) {
        if (edge.from !== current || downstreamNodes.has(edge.to)) continue;
        downstreamNodes.add(edge.to);
        downstreamEdges.add(edgeKey(edge.from, edge.to));
        downstreamQueue.push(edge.to);
      }
    }

    return { selected, upstreamNodes, downstreamNodes, upstreamEdges, downstreamEdges };
  }

  function flowRole(flow: FlowSelection | null, nodeId: string): 'selected' | 'both' | 'upstream' | 'downstream' | 'outside' {
    if (!flow) return 'outside';
    if (flow.selected === nodeId) return 'selected';
    const upstream = flow.upstreamNodes.has(nodeId);
    const downstream = flow.downstreamNodes.has(nodeId);
    if (upstream && downstream) return 'both';
    if (upstream) return 'upstream';
    if (downstream) return 'downstream';
    return 'outside';
  }

  function flowColor(role: ReturnType<typeof flowRole>, fallback: string): string {
    if (role === 'selected') return '#ffffff';
    if (role === 'both') return '#f8d66d';
    if (role === 'upstream') return '#f8d66d';
    if (role === 'downstream') return '#72f1b8';
    return fallback;
  }

  function flowEdgeRole(flow: FlowSelection | null, edge: GraphEdge): 'both' | 'upstream' | 'downstream' | 'outside' {
    if (!flow) return 'outside';
    const key = edgeKey(edge.from, edge.to);
    const upstream = flow.upstreamEdges.has(key);
    const downstream = flow.downstreamEdges.has(key);
    if (upstream && downstream) return 'both';
    if (upstream) return 'upstream';
    if (downstream) return 'downstream';
    return 'outside';
  }

  function colorForEvent(event: GraphEvent): string {
    if (event.type === 'assertion-failed') return '#ff5d8f';
    if (event.type === 'assertion-armed') return '#f8d66d';
    if (event.type === 'assertion-passed') return '#72f1b8';
    if (event.type === 'effect-run') return '#7ee787';
    if (event.type === 'derived-recompute') return '#b197fc';
    return '#6ee7f9';
  }

  function markActivity(event: GraphEvent) {
    const now = Date.now();
    const color = colorForEvent(event);
    const label = `${event.type} · ${event.metadata?.name ?? graph.getNode(event.nodeId)?.name ?? event.nodeId}`;
    const pulse = { expiresAt: now + ACTIVITY_TTL_MS, tick: event.tick, color, label };
    const eventDisplayId = displayId(event.nodeId);
    nodeActivity.set(eventDisplayId, pulse);
    lastEventLabel = label;

    for (const edge of graph.getEdges()) {
      if (edge.from !== event.nodeId && edge.to !== event.nodeId) continue;
      const from = displayId(edge.from);
      const to = displayId(edge.to);
      if (from === to) continue;
      edgeActivity.set(edgeKey(from, to), pulse);
    }

    scheduleFadeClear();
  }

  function scheduleFadeClear() {
    if (fadeTimer || disposed) return;
    fadeTimer = setTimeout(() => {
      fadeTimer = null;
      scheduleDraw(false);
      if (nodeActivity.size > 0 || edgeActivity.size > 0) scheduleFadeClear();
    }, ACTIVITY_TTL_MS + 20);
  }

  function pruneActivity(now: number) {
    for (const [id, pulse] of nodeActivity) {
      if (pulse.expiresAt <= now) nodeActivity.delete(id);
    }
    for (const [id, pulse] of edgeActivity) {
      if (pulse.expiresAt <= now) edgeActivity.delete(id);
    }
  }

  function pulseAlpha(pulse: ActivityPulse, now: number): number {
    return Math.max(0, Math.min(1, (pulse.expiresAt - now) / ACTIVITY_TTL_MS));
  }

  function draw() {
    if (disposed || !isActive()) {
      pendingWhileInactive = true;
      return;
    }
    lastDrawAt = Date.now();
    const now = lastDrawAt;
    pruneActivity(now);
    pendingWhileInactive = false;
    if (layoutDirty) {
      const model = displayModel(graph);
      layoutResult = layoutNodes(model);
      displayEdges = model.edges;
      displayIdByNodeId = model.displayIdByNodeId;
      groupedMembers = model.groupedMembers;
      if (selectedDisplayId && !model.nodes.some(node => node.id === selectedDisplayId)) {
        selectedDisplayId = null;
      }
      layoutDirty = false;
    }
    const flow = computeFlowSelection(selectedDisplayId);

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
    status.style.display = 'block';
    const activityText = `Live tick ${graph.currentTick} · ${lastEventLabel} · ${nodeActivity.size} active nodes · ${edgeActivity.size} active edges`;
    const selectedNode = selectedDisplayId ? layoutResult.find(node => node.id === selectedDisplayId) : null;
    const flowText = flow && selectedNode
      ? ` · Selected ${selectedNode.name}: ${flow.upstreamNodes.size} upstream, ${flow.downstreamNodes.size} downstream`
      : ' · Click a node to highlight flow';
    status.textContent = groupedMembers > 0
      ? `${activityText}${flowText} · Grouped ${groupedMembers} repeated player metric nodes`
      : `${activityText}${flowText}`;

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

      const active = edgeActivity.get(edgeKey(edge.from, edge.to));
      const edgeRole = flowEdgeRole(flow, edge);
      const edgeInFlow = edgeRole !== 'outside';
      if (active) {
        const alpha = pulseAlpha(active, now);
        ctx.strokeStyle = hexToRgba(active.color, 0.28 + alpha * 0.62);
        ctx.lineWidth = (edgeInFlow ? 2.4 : 1.2) + alpha * 2.2;
      } else if (edgeInFlow) {
        const color = edgeRole === 'downstream' ? '#72f1b8' : '#f8d66d';
        ctx.strokeStyle = hexToRgba(color, 0.8);
        ctx.lineWidth = 2.6;
      } else if (flow) {
        ctx.strokeStyle = 'rgba(110,231,249,0.08)';
        ctx.lineWidth = 0.8;
      } else {
        ctx.strokeStyle = 'rgba(110,231,249,0.25)';
        ctx.lineWidth = 1;
      }
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
      ctx.fillStyle = active
        ? hexToRgba(active.color, 0.42 + pulseAlpha(active, now) * 0.44)
        : edgeInFlow
          ? hexToRgba(edgeRole === 'downstream' ? '#72f1b8' : '#f8d66d', 0.86)
          : flow
            ? 'rgba(110,231,249,0.12)'
            : 'rgba(110,231,249,0.4)';
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
      const active = nodeActivity.get(n.id);
      const activeAlpha = active ? pulseAlpha(active, now) : 0;
      const role = flowRole(flow, n.id);
      const inFlow = !flow || role !== 'outside';
      const displayColor = flowColor(role, color);

      // Box
      ctx.fillStyle = '#161b22';
      if (flow && role === 'outside') ctx.globalAlpha = 0.32;
      ctx.strokeStyle = active ? active.color : displayColor;
      ctx.lineWidth = active ? 1.8 + activeAlpha * 2.2 : role === 'selected' ? 3.2 : inFlow ? 2.3 : 1.5;
      ctx.shadowColor = active ? active.color : 'transparent';
      ctx.shadowBlur = active ? 14 * activeAlpha : 0;
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
      ctx.shadowBlur = 0;

      // Type badge
      ctx.fillStyle = displayColor;
      ctx.globalAlpha = flow && role !== 'outside' ? 0.22 : flow ? 0.08 : 0.15;
      ctx.fillRect(n.x + 1, n.y + 1, NODE_W - 2, NODE_H - 2);
      ctx.globalAlpha = 1;
      if (flow && role === 'outside') ctx.globalAlpha = 0.32;

      if (active) {
        ctx.fillStyle = hexToRgba(active.color, 0.18 + activeAlpha * 0.24);
        ctx.fillRect(n.x + 3, n.y + 3, NODE_W - 6, NODE_H - 6);
        ctx.fillStyle = active.color;
        ctx.beginPath();
        ctx.arc(n.x + NODE_W - 10, n.y + 10, 3 + activeAlpha * 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Label and current value. Showing values in-canvas makes graph redraws
      // visibly live without requiring hover/tooltips.
      ctx.fillStyle = displayColor;
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
      ctx.globalAlpha = 1;
    }
  }

  // Mouse hover tooltip
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const found = findNodeAt(mx, my);
    canvas.style.cursor = found ? 'pointer' : 'default';

    if (found) {
      const valueStr = formatTooltipValue(graph, found);
      tip.textContent = `${found.name} (${found.type})${valueStr}\nDeps: ${found.deps.length}\nClick to ${selectedDisplayId === found.id ? 'clear' : 'highlight'} flow`;
      tip.style.display = 'block';
      tip.style.left = `${mx + 12}px`;
      tip.style.top = `${my + 12}px`;
      tip.style.whiteSpace = 'pre';
    } else {
      tip.style.display = 'none';
    }
  });

  canvas.addEventListener('mouseleave', () => { tip.style.display = 'none'; });

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const found = findNodeAt(e.clientX - rect.left, e.clientY - rect.top);
    selectedDisplayId = found && selectedDisplayId !== found.id ? found.id : null;
    scheduleDraw(false);
  });

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
      markActivity(event);
      scheduleDraw(false);
    }
  });

  draw();

  return {
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (fadeTimer) clearTimeout(fadeTimer);
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
