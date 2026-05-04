// visualizer.ts — Graph visualizer: nodes as colored boxes, edges as lines
// Simple force-directed-ish layout without external dependencies

import type { CircuitGraph } from '@veriscope/graph';

const NODE_COLORS: Record<string, string> = {
  signal: '#6ee7f9',
  derived: '#a78bfa',
  effect: '#72f1b8',
  assertion: '#ff5d8f',
};

const NODE_W = 120;
const NODE_H = 36;
const PADDING = 40;

interface LayoutNode {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  deps: string[];
}

function layoutNodes(graph: CircuitGraph): LayoutNode[] {
  const nodes = graph.getNodes();
  const edges = graph.getEdges();

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
      });
    }
  }

  return layoutNodes;
}

export function createVisualizerPanel(
  container: HTMLElement,
  graph: CircuitGraph,
): { dispose: () => void; refresh: () => void } {
  container.style.cssText = 'position:relative; overflow:auto; height:100%;';

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;';
  container.appendChild(canvas);

  // Tooltip
  const tip = document.createElement('div');
  tip.style.cssText = 'display:none; position:absolute; background:rgba(13,17,23,0.95); color:#c9d1d9; padding:4px 8px; border-radius:4px; font-size:0.75rem; font-family:"SF Mono",monospace; pointer-events:none; z-index:10; border:1px solid #30363d;';
  container.appendChild(tip);

  let disposed = false;
  let layoutResult: LayoutNode[] = [];

  function draw() {
    if (disposed) return;
    layoutResult = layoutNodes(graph);

    // Compute canvas size
    let maxX = 0, maxY = 0;
    for (const n of layoutResult) {
      if (n.x + NODE_W + PADDING > maxX) maxX = n.x + NODE_W + PADDING;
      if (n.y + NODE_H + PADDING > maxY) maxY = n.y + NODE_H + PADDING;
    }
    maxX = Math.max(maxX, 400);
    maxY = Math.max(maxY, 200);

    const dpr = window.devicePixelRatio || 1;
    canvas.width = maxX * dpr;
    canvas.height = maxY * dpr;
    canvas.style.width = `${maxX}px`;
    canvas.style.height = `${maxY}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, maxX, maxY);

    // Background
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, maxX, maxY);

    const nodePositions = new Map<string, { x: number; y: number }>();
    for (const n of layoutResult) {
      nodePositions.set(n.id, { x: n.x, y: n.y });
    }

    // Draw edges
    const edges = graph.getEdges();
    ctx.lineWidth = 1;
    for (const edge of edges) {
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

      // Label
      ctx.fillStyle = color;
      ctx.font = '11px "SF Mono", "Fira Code", monospace';
      ctx.textBaseline = 'middle';
      const displayName = n.name.length > 14 ? n.name.slice(0, 13) + '\u2026' : n.name;
      ctx.fillText(displayName, n.x + 6, n.y + NODE_H / 2);

      // Type indicator (small text)
      ctx.fillStyle = 'rgba(154,168,189,0.5)';
      ctx.font = '8px system-ui';
      ctx.textAlign = 'right';
      ctx.fillText(n.type, n.x + NODE_W - 4, n.y + NODE_H / 2);
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
      const node = graph.getNode(found.id);
      let valueStr = '';
      if (node?.getValue) {
        try {
          const v = node.getValue();
          valueStr = `\nValue: ${JSON.stringify(v)}`;
        } catch (_) { /* ignore */ }
      }
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

  draw();

  return {
    dispose() { disposed = true; container.innerHTML = ''; },
    refresh() { draw(); },
  };
}
