// waveform.ts — Canvas waveform viewer with hierarchy, markers, search, keyboard shortcuts
// Extracted from Comb's waveform module, adapted for standalone @veriscope/graph use

import type { CircuitGraph } from '@veriscope/graph';

// --- Types ---

export interface WaveformSignal {
  id: string;
  displayName: string;
  group: string;
  type: 'boolean' | 'numeric' | 'enum' | 'assertion' | 'coverage';
  visible: boolean;
  color: string;
  renderMode: 'analog' | 'digital';
}

interface WaveformMarker {
  id: 'A' | 'B';
  timestamp: number;
  color: string;
}

interface SearchMatch {
  timestamp: number;
  signalId: string;
  value: any;
}

interface ViewState {
  viewStart: number;
  viewEnd: number;
  markerA: number | null;
  markerB: number | null;
  hiddenSignals: string[];
}

function saveViewState(key: string, state: ViewState): void {
  localStorage.setItem(`veriscope-waveform-${key}`, JSON.stringify(state));
}

function loadViewState(key: string): ViewState | null {
  const s = localStorage.getItem(`veriscope-waveform-${key}`);
  return s ? JSON.parse(s) : null;
}

const COLORS = [
  '#6ee7f9', '#72f1b8', '#a78bfa', '#ff5d8f',
  '#f8d66d', '#5b9bd5', '#e8915a', '#c084fc',
];
const ROW_H = 56;
const LABEL_W = 120;

// --- Snap-to-edge ---

function snapToNearestEdge(
  clickTime: number,
  data: Map<string, Array<{ t: number }>>,
  visibleSignals: string[],
): number {
  let closest = clickTime;
  let minDist = Infinity;
  for (const id of visibleSignals) {
    const buf = data.get(id);
    if (!buf) continue;
    for (const entry of buf) {
      const dist = Math.abs(entry.t - clickTime);
      if (dist < minDist) { minDist = dist; closest = entry.t; }
    }
  }
  return closest;
}

// --- Signal list builder ---

function buildSignalList(graph: CircuitGraph): WaveformSignal[] {
  const nodes = graph.getNodes();
  const signals: WaveformSignal[] = [];
  for (const node of nodes) {
    if (node.type === 'signal' || node.type === 'derived') {
      const parts = node.name.split('.');
      const displayName = parts.pop() ?? node.name;
      const group = parts.join('.') || 'signals';
      let sigType: WaveformSignal['type'] = 'numeric';
      let renderMode: WaveformSignal['renderMode'] = 'analog';
      if (node.getValue) {
        try {
          const v = node.getValue();
          if (typeof v === 'boolean') { sigType = 'boolean'; renderMode = 'digital'; }
          else if (typeof v === 'string' || v === null || v === undefined) { sigType = 'enum'; renderMode = 'digital'; }
        } catch (_) { /* ignore */ }
      }
      signals.push({
        id: node.id,
        displayName,
        group,
        type: sigType,
        visible: true,
        color: COLORS[signals.length % COLORS.length],
        renderMode,
      });
    }
  }
  // Also add assertion nodes
  for (const node of nodes) {
    if (node.type === 'assertion') {
      signals.push({
        id: node.id,
        displayName: node.name,
        group: 'assertions',
        type: 'assertion',
        visible: true,
        color: COLORS[signals.length % COLORS.length],
        renderMode: 'digital',
      });
    }
  }
  return signals;
}

// --- Marker system ---

function createMarkerSystem() {
  const markers: WaveformMarker[] = [];

  function setMarker(id: 'A' | 'B', timestamp: number): void {
    const existing = markers.find(m => m.id === id);
    if (existing) {
      existing.timestamp = timestamp;
    } else {
      markers.push({
        id, timestamp,
        color: id === 'A' ? '#eef4ff' : 'rgba(238,244,255,0.5)',
      });
    }
  }

  function getDelta(): number | null {
    const a = markers.find(m => m.id === 'A');
    const b = markers.find(m => m.id === 'B');
    if (!a || !b) return null;
    return Math.abs(b.timestamp - a.timestamp);
  }

  function clear(): void { markers.length = 0; }

  function drawMarkers(
    ctx: CanvasRenderingContext2D,
    viewStart: number, viewEnd: number,
    chartW: number, height: number,
  ): void {
    const tRange = viewEnd - viewStart || 1;
    for (const marker of markers) {
      const x = LABEL_W + ((marker.timestamp - viewStart) / tRange) * chartW;
      if (x < LABEL_W || x > LABEL_W + chartW) continue;

      ctx.strokeStyle = marker.color;
      ctx.lineWidth = marker.id === 'A' ? 1.5 : 1;
      if (marker.id === 'B') ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = marker.color;
      ctx.font = 'bold 10px system-ui';
      ctx.textBaseline = 'top';
      ctx.fillText(marker.id, x + 3, 2);
    }

    const delta = getDelta();
    if (delta !== null) {
      ctx.fillStyle = 'rgba(238,244,255,0.8)';
      ctx.font = '10px "SF Mono", "Fira Code", monospace';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'right';
      ctx.fillText(`\u0394t = ${delta.toFixed(1)}ms`, LABEL_W + chartW - 4, 4);
      ctx.textAlign = 'left';
    }
  }

  function handleClick(
    e: MouseEvent, canvasRect: DOMRect,
    viewStart: number, viewEnd: number, chartW: number,
  ): boolean {
    const mouseX = e.clientX - canvasRect.left;
    if (mouseX < LABEL_W) return false;
    const tRange = viewEnd - viewStart || 1;
    const t = viewStart + ((mouseX - LABEL_W) / chartW) * tRange;
    if (e.shiftKey) setMarker('B', t);
    else setMarker('A', t);
    return true;
  }

  return { markers, setMarker, getDelta, clear, drawMarkers, handleClick };
}

// --- Search engine ---

interface SearchPredicate {
  signalName: string;
  op: 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'rises' | 'falls';
  value?: any;
}

type PredicateTree =
  | SearchPredicate
  | { kind: 'and' | 'or'; left: PredicateTree; right: PredicateTree }
  | { kind: 'within'; left: SearchPredicate; right: SearchPredicate; count: number };

function parseSinglePredicate(query: string): SearchPredicate | null {
  query = query.trim();
  if (!query) return null;
  const edgeMatch = query.match(/^(\w+)\s+(rises|falls)$/i);
  if (edgeMatch) return { signalName: edgeMatch[1], op: edgeMatch[2].toLowerCase() as 'rises' | 'falls' };
  const cmpMatch = query.match(/^(\w+)\s*(>=|<=|>|<|==|=)\s*(.+)$/);
  if (cmpMatch) {
    let op: SearchPredicate['op'];
    switch (cmpMatch[2]) {
      case '>=': op = 'gte'; break;
      case '<=': op = 'lte'; break;
      case '>': op = 'gt'; break;
      case '<': op = 'lt'; break;
      default: op = 'eq'; break;
    }
    let value: any = cmpMatch[3].trim();
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (!isNaN(Number(value))) value = Number(value);
    return { signalName: cmpMatch[1], op, value };
  }
  return null;
}

function parsePredicateTree(query: string): PredicateTree | null {
  query = query.trim();
  if (!query) return null;
  const withinMatch = query.match(/^(.+)\s+WITHIN\s+(\d+)\s+OF\s+(.+)$/i);
  if (withinMatch) {
    const left = parseSinglePredicate(withinMatch[1]);
    const right = parseSinglePredicate(withinMatch[3]);
    const count = parseInt(withinMatch[2], 10);
    if (left && right && count > 0) return { kind: 'within', left, right, count };
    return null;
  }
  const andIdx = query.search(/\s+AND\s+/i);
  if (andIdx !== -1) {
    const andMatch = query.match(/\s+AND\s+/i)!;
    const left = parsePredicateTree(query.slice(0, andIdx));
    const right = parsePredicateTree(query.slice(andIdx + andMatch[0].length));
    if (left && right) return { kind: 'and', left, right };
    return null;
  }
  const orIdx = query.search(/\s+OR\s+/i);
  if (orIdx !== -1) {
    const orMatch = query.match(/\s+OR\s+/i)!;
    const left = parsePredicateTree(query.slice(0, orIdx));
    const right = parsePredicateTree(query.slice(orIdx + orMatch[0].length));
    if (left && right) return { kind: 'or', left, right };
    return null;
  }
  return parseSinglePredicate(query);
}

function isSinglePredicate(tree: PredicateTree): tree is SearchPredicate {
  return 'signalName' in tree;
}

function matchesPredicate(pred: SearchPredicate, value: any, prevValue: any): boolean {
  switch (pred.op) {
    case 'eq': return value === pred.value || String(value) === String(pred.value);
    case 'gt': return Number(value) > Number(pred.value);
    case 'lt': return Number(value) < Number(pred.value);
    case 'gte': return Number(value) >= Number(pred.value);
    case 'lte': return Number(value) <= Number(pred.value);
    case 'rises': return !!value && !prevValue;
    case 'falls': return !value && !!prevValue;
  }
}

function resolveSignalIds(pred: SearchPredicate, signalIds: string[], signals: WaveformSignal[]): string[] {
  return signalIds.filter(id => {
    const sig = signals.find(s => s.id === id);
    const name = sig ? sig.displayName : (id.split('.').pop() ?? id);
    return name.toLowerCase() === pred.signalName.toLowerCase();
  });
}

function searchWaveform(
  query: string,
  data: Map<string, Array<{ t: number; v: any }>>,
  signalIds: string[],
  signals: WaveformSignal[],
): SearchMatch[] {
  const tree = parsePredicateTree(query);
  if (!tree) return [];

  if (isSinglePredicate(tree)) {
    const matches: SearchMatch[] = [];
    const ids = resolveSignalIds(tree, signalIds, signals);
    for (const id of ids) {
      const buf = data.get(id);
      if (!buf || buf.length === 0) continue;
      for (let i = 0; i < buf.length; i++) {
        const prevValue = i > 0 ? buf[i - 1].v : undefined;
        if (matchesPredicate(tree, buf[i].v, prevValue)) {
          matches.push({ timestamp: buf[i].t, signalId: id, value: buf[i].v });
        }
      }
    }
    matches.sort((a, b) => a.timestamp - b.timestamp);
    return matches;
  }

  // Helper: get value at timestamp for a signal (last value <= t)
  function valueAt(buf: Array<{ t: number; v: any }>, t: number): { v: any; prev: any } {
    let v: any = undefined;
    let prev: any = undefined;
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].t <= t) {
        v = buf[i].v;
        prev = i > 0 ? buf[i - 1].v : undefined;
        break;
      }
    }
    return { v, prev };
  }

  // Evaluate a predicate tree at a given timestamp
  function evalTree(node: PredicateTree, t: number): boolean {
    if (isSinglePredicate(node)) {
      const ids = resolveSignalIds(node, signalIds, signals);
      for (const id of ids) {
        const buf = data.get(id);
        if (!buf || buf.length === 0) continue;
        const { v, prev } = valueAt(buf, t);
        if (v !== undefined && matchesPredicate(node, v, prev)) return true;
      }
      return false;
    }
    if (node.kind === 'and') return evalTree(node.left, t) && evalTree(node.right, t);
    if (node.kind === 'or') return evalTree(node.left, t) || evalTree(node.right, t);
    if (node.kind === 'within') {
      // Check if left matches at t and right matches within ±count ms of t
      if (!evalTree(node.left, t)) return false;
      const tsSet2 = new Set<number>();
      const rIds = resolveSignalIds(node.right, signalIds, signals);
      for (const id of rIds) {
        const buf = data.get(id);
        if (buf) for (const e of buf) {
          if (Math.abs(e.t - t) <= node.count) tsSet2.add(e.t);
        }
      }
      for (const t2 of tsSet2) {
        if (evalTree(node.right, t2)) return true;
      }
      return false;
    }
    return false;
  }

  // Collect all timestamps from all signals
  const tsSet = new Set<number>();
  for (const id of signalIds) {
    const buf = data.get(id);
    if (buf) for (const entry of buf) tsSet.add(entry.t);
  }
  const timestamps = Array.from(tsSet).sort((a, b) => a - b);
  const matches: SearchMatch[] = [];
  for (const ts of timestamps) {
    if (evalTree(tree, ts)) {
      matches.push({ timestamp: ts, signalId: '', value: undefined });
    }
  }
  return matches.slice(0, 1000);
}

// --- Renderer ---

type WaveformData = Map<string, Array<{ t: number; v: any }>>;

function drawWaveforms(
  ctx: CanvasRenderingContext2D,
  signals: WaveformSignal[],
  data: WaveformData,
  viewStart: number, viewEnd: number,
  width: number, cursorX: number,
): { tooltipLines: string[] } {
  const visible = signals.filter(s => s.visible);
  const height = Math.max(visible.length * ROW_H, ROW_H);
  const chartW = width - LABEL_W;
  const tRange = viewEnd - viewStart || 1;
  const tooltipLines: string[] = [];

  ctx.clearRect(0, 0, width, height);

  for (let row = 0; row < visible.length; row++) {
    const sig = visible[row];
    const y0 = row * ROW_H;
    const buf = data.get(sig.id) ?? [];

    // Row background
    ctx.fillStyle = row % 2 === 0 ? 'rgba(6,9,19,0.8)' : 'rgba(15,23,40,0.6)';
    ctx.fillRect(0, y0, width, ROW_H);

    // Row separator
    ctx.strokeStyle = 'rgba(154,168,189,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y0 + ROW_H - 0.5);
    ctx.lineTo(width, y0 + ROW_H - 0.5);
    ctx.stroke();

    // Label
    ctx.fillStyle = sig.color;
    ctx.font = '11px "SF Mono", "Fira Code", monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(sig.displayName, 8, y0 + ROW_H / 2);

    // Inline value at cursor (right-aligned in label column)
    if (cursorX >= LABEL_W && cursorX < width && buf.length > 0) {
      const t = viewStart + ((cursorX - LABEL_W) / chartW) * tRange;
      let val: any = '\u2014';
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i].t <= t) { val = buf[i].v; break; }
      }
      if (typeof val === 'number') val = val.toFixed(2);
      ctx.fillStyle = 'rgba(200,210,225,0.7)';
      ctx.font = '10px "SF Mono", "Fira Code", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(String(val), LABEL_W - 6, y0 + ROW_H / 2);
      ctx.textAlign = 'left';
    }

    if (buf.length === 0) continue;

    const isBoolean = typeof buf[0].v === 'boolean';
    const padY = 8;
    const plotH = ROW_H - padY * 2;

    if (sig.type === 'assertion') {
      drawAssertionOverlay(ctx, buf, y0, padY, plotH, viewStart, tRange, chartW);
    } else if (isBoolean) {
      drawBooleanSignal(ctx, buf, y0, padY, plotH, sig.color, viewStart, tRange, chartW, width);
    } else if (sig.type === 'enum') {
      drawEnumSignal(ctx, buf, y0, padY, plotH, sig.color, viewStart, tRange, chartW, width);
    } else if (sig.renderMode === 'digital') {
      drawDigitalSignal(ctx, buf, y0, padY, plotH, sig.color, viewStart, viewEnd, tRange, chartW);
    } else {
      drawAnalogSignal(ctx, buf, y0, padY, plotH, sig.color, viewStart, viewEnd, tRange, chartW);
    }

    // Tooltip value at cursor
    if (cursorX >= LABEL_W && cursorX < width) {
      const t = viewStart + ((cursorX - LABEL_W) / chartW) * tRange;
      let val: any = '\u2014';
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i].t <= t) { val = buf[i].v; break; }
      }
      if (typeof val === 'number') val = val.toFixed(2);
      tooltipLines.push(`${sig.displayName}: ${val}`);
    }
  }

  // Cursor line
  if (cursorX >= LABEL_W && cursorX < width) {
    ctx.strokeStyle = 'rgba(238,244,255,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, height);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  return { tooltipLines };
}

function drawBooleanSignal(
  ctx: CanvasRenderingContext2D,
  buf: Array<{ t: number; v: any }>,
  y0: number, padY: number, plotH: number,
  color: string, viewStart: number, tRange: number, chartW: number, width: number,
): void {
  // Draw step waveform: high (true) at top, low (false) at bottom
  const highY = y0 + padY;
  const lowY = y0 + padY + plotH;

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < buf.length; i++) {
    const x = LABEL_W + ((buf[i].t - viewStart) / tRange) * chartW;
    const y = buf[i].v ? highY : lowY;
    if (!started) { ctx.moveTo(x, y); started = true; }
    else {
      // Step: horizontal to previous Y, then vertical to new Y
      ctx.lineTo(x, buf[i - 1].v ? highY : lowY);
      ctx.lineTo(x, y);
    }
  }
  // Extend to the right edge
  if (started && buf.length > 0) {
    ctx.lineTo(LABEL_W + chartW, buf[buf.length - 1].v ? highY : lowY);
  }
  ctx.stroke();

  // Fill true regions with translucent color
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.15;
  for (let i = 0; i < buf.length; i++) {
    if (!buf[i].v) continue;
    const x1 = LABEL_W + ((buf[i].t - viewStart) / tRange) * chartW;
    const x2 = i + 1 < buf.length
      ? LABEL_W + ((buf[i + 1].t - viewStart) / tRange) * chartW
      : LABEL_W + chartW;
    if (x2 < LABEL_W || x1 > width) continue;
    ctx.fillRect(Math.max(x1, LABEL_W), highY, Math.max(x2 - Math.max(x1, LABEL_W), 2), plotH);
  }
  ctx.globalAlpha = 1;

  // Labels
  ctx.fillStyle = 'rgba(154,168,189,0.4)';
  ctx.font = '9px system-ui';
  ctx.textBaseline = 'top';
  ctx.fillText('T', LABEL_W + 2, highY + 1);
  ctx.textBaseline = 'bottom';
  ctx.fillText('F', LABEL_W + 2, lowY - 1);
}

function drawEnumSignal(
  ctx: CanvasRenderingContext2D,
  buf: Array<{ t: number; v: any }>,
  y0: number, padY: number, plotH: number,
  color: string, viewStart: number, tRange: number, chartW: number, width: number,
): void {
  // Draw colored blocks for each value span with text labels
  for (let i = 0; i < buf.length; i++) {
    const x1 = LABEL_W + ((buf[i].t - viewStart) / tRange) * chartW;
    const x2 = i + 1 < buf.length
      ? LABEL_W + ((buf[i + 1].t - viewStart) / tRange) * chartW
      : LABEL_W + chartW;
    if (x2 < LABEL_W || x1 > width) continue;

    const clampX1 = Math.max(x1, LABEL_W);
    const blockW = Math.max(x2 - clampX1, 2);

    // Background fill
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.15;
    ctx.fillRect(clampX1, y0 + padY, blockW, plotH);
    ctx.globalAlpha = 1;

    // Top/bottom border lines for transitions
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(clampX1, y0 + padY);
    ctx.lineTo(clampX1 + blockW, y0 + padY);
    ctx.moveTo(clampX1, y0 + padY + plotH);
    ctx.lineTo(clampX1 + blockW, y0 + padY + plotH);
    ctx.stroke();

    // Vertical transition line
    if (i > 0) {
      ctx.beginPath();
      ctx.moveTo(clampX1, y0 + padY);
      ctx.lineTo(clampX1, y0 + padY + plotH);
      ctx.stroke();
    }

    // Text label (only if block is wide enough)
    if (blockW > 20) {
      const label = String(buf[i].v ?? 'null');
      const displayLabel = label.length > 12 ? label.slice(0, 11) + '\u2026' : label;
      ctx.fillStyle = color;
      ctx.font = '9px "SF Mono", "Fira Code", monospace';
      ctx.textBaseline = 'middle';
      ctx.save();
      ctx.beginPath();
      ctx.rect(clampX1, y0 + padY, blockW, plotH);
      ctx.clip();
      ctx.fillText(displayLabel, clampX1 + 3, y0 + ROW_H / 2);
      ctx.restore();
    }
  }
}

function drawAnalogSignal(
  ctx: CanvasRenderingContext2D,
  buf: Array<{ t: number; v: any }>,
  y0: number, padY: number, plotH: number,
  color: string, viewStart: number, viewEnd: number, tRange: number, chartW: number,
): void {
  let vMin = Infinity, vMax = -Infinity;
  for (const pt of buf) {
    if (pt.t < viewStart || pt.t > viewEnd) continue;
    const v = Number(pt.v);
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  if (vMin === Infinity) { vMin = 0; vMax = 1; }
  if (vMax === vMin) { vMin -= 1; vMax += 1; }
  const margin = (vMax - vMin) * 0.1;
  vMin -= margin; vMax += margin;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < buf.length; i++) {
    const x = LABEL_W + ((buf[i].t - viewStart) / tRange) * chartW;
    const v = Number(buf[i].v);
    const y = y0 + padY + plotH - ((v - vMin) / (vMax - vMin)) * plotH;
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = 'rgba(154,168,189,0.4)';
  ctx.font = '9px system-ui';
  ctx.textBaseline = 'top';
  ctx.fillText(vMax.toFixed(1), LABEL_W + 2, y0 + 2);
  ctx.textBaseline = 'bottom';
  ctx.fillText(vMin.toFixed(1), LABEL_W + 2, y0 + ROW_H - 2);
}

function drawDigitalSignal(
  ctx: CanvasRenderingContext2D,
  buf: Array<{ t: number; v: any }>,
  y0: number, padY: number, plotH: number,
  color: string, viewStart: number, viewEnd: number, tRange: number, chartW: number,
): void {
  let vMin = Infinity, vMax = -Infinity;
  for (const pt of buf) {
    if (pt.t < viewStart || pt.t > viewEnd) continue;
    const v = Number(pt.v);
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  if (vMin === Infinity) { vMin = 0; vMax = 1; }
  if (vMax === vMin) { vMin -= 1; vMax += 1; }
  const margin = (vMax - vMin) * 0.1;
  vMin -= margin; vMax += margin;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  let prevY = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = LABEL_W + ((buf[i].t - viewStart) / tRange) * chartW;
    const v = Number(buf[i].v);
    const y = y0 + padY + plotH - ((v - vMin) / (vMax - vMin)) * plotH;
    if (!started) { ctx.moveTo(x, y); started = true; }
    else { ctx.lineTo(x, prevY); ctx.lineTo(x, y); }
    prevY = y;
  }
  if (started) ctx.lineTo(LABEL_W + chartW, prevY);
  ctx.stroke();

  ctx.fillStyle = 'rgba(154,168,189,0.4)';
  ctx.font = '9px system-ui';
  ctx.textBaseline = 'top';
  ctx.fillText(vMax.toFixed(1), LABEL_W + 2, y0 + 2);
  ctx.textBaseline = 'bottom';
  ctx.fillText(vMin.toFixed(1), LABEL_W + 2, y0 + ROW_H - 2);
}

function drawAssertionOverlay(
  ctx: CanvasRenderingContext2D,
  buf: Array<{ t: number; v: any }>,
  y0: number, padY: number, plotH: number,
  viewStart: number, tRange: number, chartW: number,
): void {
  for (const pt of buf) {
    const val = pt.v;
    if (!val || typeof val !== 'object') continue;
    const x1 = LABEL_W + ((val.start - viewStart) / tRange) * chartW;
    const x2 = LABEL_W + (((val.end || pt.t) - viewStart) / tRange) * chartW;
    const barColor = val.status === 'passed' ? '#72f1b8' :
                     val.status === 'failed' ? '#ff5d8f' : '#f8d66d';
    ctx.fillStyle = barColor;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(x1, y0 + padY, Math.max(x2 - x1, 4), plotH);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = barColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(x1, y0 + padY, Math.max(x2 - x1, 4), plotH);
  }
}

// --- Hierarchy browser ---

function createHierarchyBrowser(
  container: HTMLElement,
  signals: WaveformSignal[],
  onToggleVisibility: (signalId: string) => void,
  onToggleRenderMode: (signalId: string) => void,
): { update: () => void; dispose: () => void } {
  const panel = document.createElement('div');
  panel.style.cssText = `
    display:flex; flex-direction:column; gap:0;
    font-size:0.7rem; font-family:"SF Mono","Fira Code",monospace;
    max-height:100%; overflow-y:auto; padding:2px 0;
  `;
  container.appendChild(panel);

  interface HierGroup { name: string; signals: WaveformSignal[]; collapsed: boolean; }
  const groups = new Map<string, HierGroup>();

  function buildGroups() {
    groups.clear();
    for (const sig of signals) {
      let group = groups.get(sig.group);
      if (!group) {
        group = { name: sig.group, signals: [], collapsed: false };
        groups.set(sig.group, group);
      }
      group.signals.push(sig);
    }
  }

  function render() {
    panel.innerHTML = '';
    for (const [, group] of groups) {
      const header = document.createElement('div');
      header.style.cssText = `
        padding:3px 6px; cursor:pointer; color:#9aa8bd;
        display:flex; align-items:center; gap:4px;
        user-select:none; font-weight:600; font-size:0.65rem;
        text-transform:uppercase; letter-spacing:0.5px;
      `;
      header.innerHTML = `<span style="font-size:8px">${group.collapsed ? '\u25B6' : '\u25BC'}</span> ${group.name}`;
      header.addEventListener('click', () => { group.collapsed = !group.collapsed; render(); });
      panel.appendChild(header);

      if (group.collapsed) continue;

      for (const sig of group.signals) {
        const entry = document.createElement('div');
        entry.style.cssText = `
          padding:2px 6px 2px 18px; display:flex; align-items:center; gap:6px;
          cursor:pointer; transition:background 0.1s;
          opacity:${sig.visible ? '1' : '0.35'};
        `;
        entry.addEventListener('mouseenter', () => { entry.style.background = 'rgba(110,231,249,0.06)'; });
        entry.addEventListener('mouseleave', () => { entry.style.background = ''; });

        const dot = document.createElement('span');
        dot.style.cssText = `width:8px; height:8px; border-radius:50%; background:${sig.color}; flex-shrink:0;`;

        const name = document.createElement('span');
        name.style.cssText = `flex:1; color:${sig.visible ? sig.color : '#666'}; font-size:0.68rem;`;
        name.textContent = sig.displayName;

        const mode = document.createElement('span');
        mode.style.cssText = 'color:#666; font-size:0.6rem; cursor:pointer;';
        mode.textContent = sig.renderMode === 'digital' ? '\u2581\u2582\u2583' : '\u223F';
        mode.title = `Click to toggle render mode (current: ${sig.renderMode})`;
        mode.addEventListener('click', (e) => {
          e.stopPropagation();
          onToggleRenderMode(sig.id);
          render();
        });

        entry.appendChild(dot);
        entry.appendChild(name);
        entry.appendChild(mode);
        entry.addEventListener('click', () => { onToggleVisibility(sig.id); render(); });
        panel.appendChild(entry);
      }
    }
  }

  buildGroups();
  render();

  return {
    update() { buildGroups(); render(); },
    dispose() { panel.remove(); },
  };
}

// --- Main waveform panel ---

export function createWaveformPanel(
  container: HTMLElement,
  graph: CircuitGraph,
): { dispose: () => void; refresh: () => void } {
  let disposed = false;
  let signals = buildSignalList(graph);
  const markers = createMarkerSystem();

  let cursorX = -1;
  let viewStart = 0;
  let viewEnd = 0;
  let viewInitialized = false;
  let userInteracted = false;
  let searchMatches: SearchMatch[] = [];
  let searchIndex = -1;
  let isPanning = false;
  let panStartX = 0;
  let panStartViewStart = 0;
  let panStartViewEnd = 0;

  container.style.cssText = 'position:relative; display:flex; flex-direction:column; overflow:hidden; height:100%;';

  // Ensure recording is active — clear stale view state since this is a new session
  graph.startRecording();
  const stateKey = 'default';
  localStorage.removeItem(`veriscope-waveform-${stateKey}`);

  // --- Control bar ---
  const controlBar = document.createElement('div');
  controlBar.style.cssText = 'display:flex; align-items:center; gap:4px; padding:3px 8px; background:#0d1117; border-bottom:1px solid #21262d; font-size:0.7rem; flex-wrap:wrap; flex-shrink:0;';

  // Search bar
  const searchBar = document.createElement('div');
  searchBar.style.cssText = 'display:flex; align-items:center; gap:6px; font-size:0.7rem;';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search: signal > value, A rises AND B == false...';
  searchInput.style.cssText = 'background:#161b22; border:1px solid #21262d; color:#c9d1d9; padding:2px 6px; border-radius:3px; font-size:0.7rem; font-family:inherit; min-width:180px;';
  const searchCount = document.createElement('span');
  searchCount.style.cssText = 'color:#666; font-family:"SF Mono",monospace; min-width:40px;';

  const prevBtn = document.createElement('button');
  prevBtn.textContent = '\u25B2';
  prevBtn.style.cssText = 'background:#21262d; border:1px solid #30363d; color:#c9d1d9; padding:1px 4px; border-radius:2px; cursor:pointer; font-size:0.6rem;';
  const nextBtn = document.createElement('button');
  nextBtn.textContent = '\u25BC';
  nextBtn.style.cssText = prevBtn.style.cssText;

  function runSearch() {
    const data = graph.getWaveformData();
    const ids = signals.map(s => s.id);
    searchMatches = searchWaveform(searchInput.value, data, ids, signals);
    searchIndex = searchMatches.length > 0 ? 0 : -1;
    searchCount.textContent = searchMatches.length > 0 ? `${searchIndex + 1}/${searchMatches.length}` : '';
    if (searchIndex >= 0) navigateToMatch(searchMatches[searchIndex]);
  }

  searchInput.addEventListener('input', runSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { if (e.shiftKey) goPrev(); else goNext(); }
  });
  prevBtn.addEventListener('click', goPrev);
  nextBtn.addEventListener('click', goNext);

  function goNext() {
    if (searchMatches.length === 0) return;
    searchIndex = (searchIndex + 1) % searchMatches.length;
    searchCount.textContent = `${searchIndex + 1}/${searchMatches.length}`;
    navigateToMatch(searchMatches[searchIndex]);
  }
  function goPrev() {
    if (searchMatches.length === 0) return;
    searchIndex = (searchIndex - 1 + searchMatches.length) % searchMatches.length;
    searchCount.textContent = `${searchIndex + 1}/${searchMatches.length}`;
    navigateToMatch(searchMatches[searchIndex]);
  }

  searchBar.appendChild(searchInput);
  searchBar.appendChild(prevBtn);
  searchBar.appendChild(nextBtn);
  searchBar.appendChild(searchCount);
  controlBar.appendChild(searchBar);

  // Export JSON button
  const exportBtn = document.createElement('button');
  exportBtn.style.cssText = 'background:#21262d; border:1px solid #30363d; color:#c9d1d9; padding:1px 6px; border-radius:2px; cursor:pointer; font-size:0.7rem; margin-left:8px;';
  exportBtn.textContent = 'Export JSON';
  exportBtn.addEventListener('click', () => {
    const data = graph.getWaveformData();
    const obj: Record<string, Array<{ t: number; v: any }>> = {};
    for (const [id, buf] of data) obj[id] = buf;
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `veriscope-waveform-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  controlBar.appendChild(exportBtn);

  // Zoom buttons
  const zoomGroup = document.createElement('span');
  zoomGroup.style.cssText = 'display:flex; gap:3px; margin-left:auto;';
  for (const [label, action] of [['Fit', 'fit'], ['Zoom +', 'in'], ['Zoom \u2212', 'out']] as const) {
    const btn = document.createElement('button');
    btn.style.cssText = 'background:#21262d; border:1px solid #30363d; color:#c9d1d9; padding:1px 6px; border-radius:2px; cursor:pointer; font-size:0.7rem;';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      if (action === 'fit') { viewInitialized = false; userInteracted = false; }
      else {
        userInteracted = true;
        const range = viewEnd - viewStart;
        const mid = (viewStart + viewEnd) / 2;
        const factor = action === 'in' ? 0.5 : 2;
        const newRange = range * factor;
        viewStart = mid - newRange / 2;
        viewEnd = mid + newRange / 2;
      }
      draw();
    });
    zoomGroup.appendChild(btn);
  }
  controlBar.appendChild(zoomGroup);
  container.appendChild(controlBar);

  // --- Main content row ---
  const mainRow = document.createElement('div');
  mainRow.style.cssText = 'display:flex; flex:1; min-height:0;';
  container.appendChild(mainRow);

  // Hierarchy panel
  const hierPanel = document.createElement('div');
  hierPanel.style.cssText = 'width:140px; flex-shrink:0; border-right:1px solid #21262d; overflow-y:auto; background:#0d1117;';
  mainRow.appendChild(hierPanel);

  const hierarchyBrowser = createHierarchyBrowser(
    hierPanel, signals,
    (signalId) => {
      const sig = signals.find(s => s.id === signalId);
      if (sig) { sig.visible = !sig.visible; resize(); draw(); }
    },
    (signalId) => {
      const sig = signals.find(s => s.id === signalId);
      if (sig) { sig.renderMode = sig.renderMode === 'analog' ? 'digital' : 'analog'; draw(); }
    },
  );

  // Canvas container
  const canvasWrap = document.createElement('div');
  canvasWrap.style.cssText = 'flex:1; min-width:0; min-height:0; position:relative; overflow-y:auto; overflow-x:hidden;';
  mainRow.appendChild(canvasWrap);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%; display:block; cursor:crosshair;';
  canvasWrap.appendChild(canvas);

  const tooltip = document.createElement('div');
  tooltip.style.cssText = 'display:none; position:sticky; background:rgba(13,17,23,0.9); color:#c9d1d9; padding:2px 6px; border-radius:3px; font-size:0.7rem; font-family:"SF Mono",monospace; pointer-events:none; z-index:10;';
  canvasWrap.appendChild(tooltip);

  // --- Drawing ---
  function getVisibleSignals(): WaveformSignal[] {
    return signals.filter(s => s.visible);
  }

  function resize() {
    const visible = getVisibleSignals();
    const w = canvasWrap.clientWidth;
    const h = Math.max(visible.length * ROW_H, ROW_H);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
  }

  function draw() {
    if (disposed) return;
    const visible = getVisibleSignals();
    const w = canvasWrap.clientWidth;
    const h = Math.max(visible.length * ROW_H, ROW_H);
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const data = graph.getWaveformData();
    const chartW = w - LABEL_W;

    if (!viewInitialized || !userInteracted) {
      // Find the time range where actual changes happen (skip flat initial snapshots)
      let tFirstChange = Infinity, tMax = -Infinity;
      for (const sig of visible) {
        const buf = data.get(sig.id);
        if (buf && buf.length > 1) {
          // First change is the second data point (first is the initial snapshot)
          if (buf[1].t < tFirstChange) tFirstChange = buf[1].t;
          if (buf[buf.length - 1].t > tMax) tMax = buf[buf.length - 1].t;
        } else if (buf && buf.length === 1) {
          if (buf[0].t > tMax) tMax = buf[0].t;
        }
      }
      if (tMax === -Infinity) { tMax = 5000; tFirstChange = 0; }
      if (tFirstChange === Infinity) tFirstChange = tMax - 5000;
      // Show from slightly before first change to slightly after last, min 5s window
      const padding = 500;
      const rangeStart = tFirstChange - padding;
      const range = Math.max(tMax - rangeStart + padding, 5000);
      viewStart = rangeStart;
      viewEnd = rangeStart + range;
      viewInitialized = true;
    }

    const { tooltipLines } = drawWaveforms(ctx, visible, data, viewStart, viewEnd, w, cursorX);
    markers.drawMarkers(ctx, viewStart, viewEnd, chartW, h);

    // Search match highlights
    if (searchMatches.length > 0) {
      const tRange = viewEnd - viewStart || 1;
      for (let i = 0; i < searchMatches.length; i++) {
        const match = searchMatches[i];
        const x = LABEL_W + ((match.timestamp - viewStart) / tRange) * chartW;
        if (x < LABEL_W || x > w) continue;
        ctx.fillStyle = i === searchIndex ? '#f8d66d' : 'rgba(248,214,109,0.3)';
        ctx.fillRect(x - 1, 0, 3, h);
      }
    }

    if (cursorX >= LABEL_W && cursorX < w && tooltipLines.length > 0) {
      tooltip.textContent = tooltipLines.join('  |  ');
      tooltip.style.display = 'block';
      tooltip.style.left = `${Math.min(cursorX + 10, w - 200)}px`;
      tooltip.style.top = '4px';
    } else {
      tooltip.style.display = 'none';
    }

    ctx.restore();
  }

  function navigateToMatch(match: SearchMatch) {
    userInteracted = true;
    const range = viewEnd - viewStart;
    viewStart = match.timestamp - range * 0.3;
    viewEnd = match.timestamp + range * 0.7;
    markers.setMarker('A', match.timestamp);
    draw();
  }

  // --- Mouse interaction ---
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    cursorX = e.clientX - rect.left;
    if (isPanning) {
      userInteracted = true;
      const dx = e.clientX - panStartX;
      const chartW = canvasWrap.clientWidth - LABEL_W;
      const tRange = panStartViewEnd - panStartViewStart;
      const dt = -(dx / chartW) * tRange;
      viewStart = panStartViewStart + dt;
      viewEnd = panStartViewEnd + dt;
    }
    draw();
  });

  canvas.addEventListener('mouseleave', () => { cursorX = -1; draw(); });

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    if (mouseX >= LABEL_W) {
      if (e.altKey || e.metaKey) {
        const chartW = canvasWrap.clientWidth - LABEL_W;
        const tRange = viewEnd - viewStart || 1;
        const rawT = viewStart + ((mouseX - LABEL_W) / chartW) * tRange;
        const waveData = graph.getWaveformData();
        const visIds = getVisibleSignals().map(s => s.id);
        const snapped = snapToNearestEdge(rawT, waveData, visIds);
        const markerId: 'A' | 'B' = e.shiftKey ? 'B' : 'A';
        markers.setMarker(markerId, snapped);
        draw();
      } else {
        isPanning = true;
        panStartX = e.clientX;
        panStartViewStart = viewStart;
        panStartViewEnd = viewEnd;
        canvas.style.cursor = 'grabbing';
      }
    }
  });

  const handleMouseUp = () => { isPanning = false; canvas.style.cursor = 'crosshair'; };
  window.addEventListener('mouseup', handleMouseUp);

  canvas.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      if (mouseX < LABEL_W) return;
      userInteracted = true;
      const chartW = canvasWrap.clientWidth - LABEL_W;
      const ratio = (mouseX - LABEL_W) / chartW;
      const tRange = viewEnd - viewStart;
      const factor = e.deltaY > 0 ? 1.3 : 0.7;
      const newRange = tRange * factor;
      const anchor = viewStart + ratio * tRange;
      viewStart = anchor - ratio * newRange;
      viewEnd = anchor + (1 - ratio) * newRange;
      draw();
    } else {
      const maxScroll = canvasWrap.scrollHeight - canvasWrap.clientHeight;
      if (maxScroll > 0) { e.preventDefault(); canvasWrap.scrollTop += e.deltaY; }
    }
  }, { passive: false });

  // --- Keyboard shortcuts ---
  let mouseIsOver = false;
  container.addEventListener('mouseenter', () => { mouseIsOver = true; });
  container.addEventListener('mouseleave', () => { mouseIsOver = false; });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!mouseIsOver) return;
    const range = viewEnd - viewStart;
    const mid = (viewStart + viewEnd) / 2;
    switch (e.key) {
      case '+': case '=': {
        e.preventDefault(); userInteracted = true;
        const nr = range * 0.7; viewStart = mid - nr / 2; viewEnd = mid + nr / 2; draw(); break;
      }
      case '-': {
        e.preventDefault(); userInteracted = true;
        const nr = range * 1.4; viewStart = mid - nr / 2; viewEnd = mid + nr / 2; draw(); break;
      }
      case 'ArrowLeft': {
        e.preventDefault(); userInteracted = true;
        const s = range * 0.1; viewStart -= s; viewEnd -= s; draw(); break;
      }
      case 'ArrowRight': {
        e.preventDefault(); userInteracted = true;
        const s = range * 0.1; viewStart += s; viewEnd += s; draw(); break;
      }
      case 'Home': {
        e.preventDefault(); viewInitialized = false; userInteracted = false; draw(); break;
      }
      case 'Escape': {
        e.preventDefault(); markers.clear(); draw(); break;
      }
    }
  };
  window.addEventListener('keydown', handleKeyDown);

  // --- Init ---
  resize();
  draw();

  // Track last known container width to detect when resize is needed
  let lastContainerWidth = 0;

  // Refresh signals from graph periodically (new signals may appear)
  const interval = setInterval(() => {
    if (disposed) return;
    const newSignals = buildSignalList(graph);
    if (newSignals.length !== signals.length) {
      // Preserve visibility state
      const visMap = new Map(signals.map(s => [s.id, s.visible]));
      const modeMap = new Map(signals.map(s => [s.id, s.renderMode]));
      for (const s of newSignals) {
        if (visMap.has(s.id)) s.visible = visMap.get(s.id)!;
        if (modeMap.has(s.id)) s.renderMode = modeMap.get(s.id)!;
      }
      signals = newSignals;
      hierarchyBrowser.update();
      resize();
      lastContainerWidth = canvasWrap.clientWidth;
    }
    // Re-resize if container width changed (e.g. panel became visible after being hidden)
    const currentWidth = canvasWrap.clientWidth;
    if (currentWidth > 0 && currentWidth !== lastContainerWidth) {
      lastContainerWidth = currentWidth;
      resize();
    }
    draw();
  }, 500);

  function dispose() {
    // Persist view state before teardown
    const markerA = markers.markers.find(m => m.id === 'A');
    const markerB = markers.markers.find(m => m.id === 'B');
    saveViewState(stateKey, {
      viewStart,
      viewEnd,
      markerA: markerA ? markerA.timestamp : null,
      markerB: markerB ? markerB.timestamp : null,
      hiddenSignals: signals.filter(s => !s.visible).map(s => s.id),
    });

    disposed = true;
    clearInterval(interval);
    window.removeEventListener('mouseup', handleMouseUp);
    window.removeEventListener('keydown', handleKeyDown);
    hierarchyBrowser.dispose();
    container.innerHTML = '';
  }

  return {
    dispose,
    refresh() {
      signals = buildSignalList(graph);
      hierarchyBrowser.update();
      resize();
      draw();
    },
  };
}
