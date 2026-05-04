export const COLS = 10;
export const ROWS = 20;

export type PlayerId = string;
export type PlayerKind = 'human' | 'ai';
export type PieceName = 'I' | 'O' | 'T' | 'S' | 'Z' | 'L' | 'J';
export type Cell = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type OpponentCount = number;

export interface PlayerState {
  id: PlayerId;
  name: string;
  kind: PlayerKind;
  board: Cell[][];
  piece: PieceName;
  nextPiece: PieceName;
  x: number;
  y: number;
  rot: number;
  score: number;
  lines: number;
  pendingGarbage: number;
  lastCleared: number;
  lastSent: number;
  lastReceived: number;
  ko: boolean;
  aiTarget?: { x: number; rot: number };
}

export interface GarbageSend {
  from: PlayerId;
  to: PlayerId;
  lines: number;
}

export interface ArenaTickResult {
  players: PlayerState[];
  sends: GarbageSend[];
}

export const MIN_OPPONENTS = 1;
export const DEFAULT_OPPONENTS = 3;
export const MAX_OPPONENTS = 99;

export function clampOpponentCount(value: number): OpponentCount {
  if (!Number.isFinite(value)) return DEFAULT_OPPONENTS;
  return Math.max(MIN_OPPONENTS, Math.min(MAX_OPPONENTS, Math.floor(value)));
}

export function playerIdAt(index: number): PlayerId {
  return `p${index + 1}`;
}

export function playerIdsFor(opponentCount: number): PlayerId[] {
  const count = clampOpponentCount(opponentCount);
  return Array.from({ length: count + 1 }, (_, index) => playerIdAt(index));
}

export function targetIdsFor(opponentCount: number): PlayerId[] {
  return playerIdsFor(opponentCount).slice(1);
}

export const PIECE_COLORS: Record<number, string> = {
  1: '#63d2ff',
  2: '#ffd166',
  3: '#a78bfa',
  4: '#5ee6a8',
  5: '#ff5f7e',
  6: '#f59e62',
  7: '#5b8def',
  8: '#6b7280',
};

const PIECES: Record<PieceName, number[][][]> = {
  I: [
    [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0]],
    [[0, 0, 0, 0], [0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0]],
    [[0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0]],
  ],
  O: [
    [[1, 1], [1, 1]],
    [[1, 1], [1, 1]],
    [[1, 1], [1, 1]],
    [[1, 1], [1, 1]],
  ],
  T: [
    [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    [[0, 1, 0], [0, 1, 1], [0, 1, 0]],
    [[0, 0, 0], [1, 1, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 1, 0], [0, 1, 0]],
  ],
  S: [
    [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    [[0, 1, 0], [0, 1, 1], [0, 0, 1]],
    [[0, 0, 0], [0, 1, 1], [1, 1, 0]],
    [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
  ],
  Z: [
    [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
    [[0, 0, 1], [0, 1, 1], [0, 1, 0]],
    [[0, 0, 0], [1, 1, 0], [0, 1, 1]],
    [[0, 1, 0], [1, 1, 0], [1, 0, 0]],
  ],
  L: [
    [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
    [[0, 1, 0], [0, 1, 0], [0, 1, 1]],
    [[0, 0, 0], [1, 1, 1], [1, 0, 0]],
    [[1, 1, 0], [0, 1, 0], [0, 1, 0]],
  ],
  J: [
    [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    [[0, 1, 1], [0, 1, 0], [0, 1, 0]],
    [[0, 0, 0], [1, 1, 1], [0, 0, 1]],
    [[0, 1, 0], [0, 1, 0], [1, 1, 0]],
  ],
};

const PIECE_NAMES = Object.keys(PIECES) as PieceName[];
const SCORE_BY_LINES = [0, 100, 300, 500, 800];

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const rng = makeRng(0x5eed2026);

function randomPiece(): PieceName {
  return PIECE_NAMES[Math.floor(rng() * PIECE_NAMES.length)];
}

export function emptyBoard(): Cell[][] {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => 0 as Cell));
}

export function createPlayer(id: PlayerId, name: string, kind: PlayerKind): PlayerState {
  const player: PlayerState = {
    id,
    name,
    kind,
    board: emptyBoard(),
    piece: randomPiece(),
    nextPiece: randomPiece(),
    x: 3,
    y: 0,
    rot: 0,
    score: 0,
    lines: 0,
    pendingGarbage: 0,
    lastCleared: 0,
    lastSent: 0,
    lastReceived: 0,
    ko: false,
  };
  return spawn(player);
}

export function clonePlayer(player: PlayerState): PlayerState {
  return {
    ...player,
    board: player.board.map(row => [...row] as Cell[]),
    aiTarget: player.aiTarget ? { ...player.aiTarget } : undefined,
  };
}

export function shapeFor(piece: PieceName, rot: number): number[][] {
  return PIECES[piece][rot % 4];
}

export function collides(board: Cell[][], piece: PieceName, x: number, y: number, rot: number): boolean {
  const shape = shapeFor(piece, rot);
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const gx = x + c;
      const gy = y + r;
      if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
      if (gy >= 0 && board[gy][gx] !== 0) return true;
    }
  }
  return false;
}

export function move(player: PlayerState, dx: number): PlayerState {
  const next = clonePlayer(player);
  if (!next.ko && !collides(next.board, next.piece, next.x + dx, next.y, next.rot)) {
    next.x += dx;
  }
  return next;
}

export function rotate(player: PlayerState): PlayerState {
  const next = clonePlayer(player);
  const rot = (next.rot + 1) % 4;
  if (!next.ko && !collides(next.board, next.piece, next.x, next.y, rot)) {
    next.rot = rot;
  }
  return next;
}

export function hardDrop(player: PlayerState): PlayerState {
  let next = clonePlayer(player);
  if (next.ko) return next;
  while (!collides(next.board, next.piece, next.x, next.y + 1, next.rot)) {
    next.y++;
  }
  next = lockAndSpawn(next);
  return next;
}

export function softDrop(player: PlayerState): PlayerState {
  const next = clonePlayer(player);
  if (!next.ko && !collides(next.board, next.piece, next.x, next.y + 1, next.rot)) {
    next.y++;
  }
  return next;
}

export function advanceArena(
  players: PlayerState[],
  humanTarget: PlayerId,
  options?: { holdHumanGarbage?: boolean },
): ArenaTickResult {
  const next = players.map(player => {
    const clone = clonePlayer(player);
    clone.lastCleared = 0;
    return clone;
  });

  for (let i = 0; i < next.length; i++) {
    if (next[i].ko) continue;
    if (next[i].kind === 'ai') {
      next[i] = applyAi(next[i]);
    }
    next[i] = gravity(next[i]);
  }

  const sends: GarbageSend[] = [];
  for (const player of next) {
    const lines = linesToGarbage(player.lastCleared);
    if (lines <= 0) continue;
    if (player.id === 'p1' && options?.holdHumanGarbage) continue;
    const target = chooseTarget(player, next, humanTarget);
    if (!target) continue;
    const send = deliverGarbage(player, target, lines);
    if (send) sends.push(send);
  }

  return { players: next, sends };
}

export function garbageFromClearedLines(cleared: number): number {
  return linesToGarbage(cleared);
}

export function sendManualGarbage(players: PlayerState[], from: PlayerId, to: PlayerId, lines: number): ArenaTickResult {
  const next = players.map(clonePlayer);
  const sender = next.find(p => p.id === from);
  const target = next.find(p => p.id === to);
  if (!sender || !target || sender.id === target.id || target.ko) {
    return { players: next, sends: [] };
  }
  const send = deliverGarbage(sender, target, lines);
  return { players: next, sends: send ? [send] : [] };
}

export function resetPlayers(opponentCount: OpponentCount = DEFAULT_OPPONENTS): PlayerState[] {
  const count = clampOpponentCount(opponentCount);
  return [
    createPlayer('p1', 'You', 'human'),
    ...Array.from({ length: count }, (_, index) => createPlayer(playerIdAt(index + 1), `AI ${index + 1}`, 'ai')),
  ];
}

function gravity(player: PlayerState): PlayerState {
  const next = clonePlayer(player);
  if (!collides(next.board, next.piece, next.x, next.y + 1, next.rot)) {
    next.y++;
    return next;
  }
  return lockAndSpawn(next);
}

function lockAndSpawn(player: PlayerState): PlayerState {
  const next = clonePlayer(player);
  if (locksAboveTop(next)) {
    next.ko = true;
    return next;
  }
  lockPiece(next);
  const cleared = clearLines(next);
  next.lastCleared = cleared;
  if (cleared > 0) {
    next.lines += cleared;
    next.score += SCORE_BY_LINES[cleared] ?? cleared * 250;
  }
  if (next.pendingGarbage > 0) {
    addGarbage(next, Math.min(next.pendingGarbage, 8));
    next.pendingGarbage = 0;
  }
  return spawn(next);
}

function spawn(player: PlayerState): PlayerState {
  const next = clonePlayer(player);
  next.piece = next.nextPiece;
  next.nextPiece = randomPiece();
  next.x = 3;
  next.y = -2;
  next.rot = 0;
  next.aiTarget = undefined;
  if (collides(next.board, next.piece, next.x, next.y, next.rot)) {
    next.ko = true;
  }
  return next;
}

function lockPiece(player: PlayerState): void {
  const shape = shapeFor(player.piece, player.rot);
  const color = (PIECE_NAMES.indexOf(player.piece) + 1) as Cell;
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const gy = player.y + r;
      const gx = player.x + c;
      if (gy >= 0 && gy < ROWS && gx >= 0 && gx < COLS) {
        player.board[gy][gx] = color;
      }
    }
  }
}

function clearLines(player: PlayerState): number {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (player.board[r].every(cell => cell !== 0)) {
      player.board.splice(r, 1);
      player.board.unshift(Array.from({ length: COLS }, () => 0 as Cell));
      cleared++;
      r++;
    }
  }
  return cleared;
}

function addGarbage(player: PlayerState, lines: number): void {
  for (let i = 0; i < lines; i++) {
    if (player.board[0].some(cell => cell !== 0)) {
      player.ko = true;
      return;
    }
    const gap = Math.floor(rng() * COLS);
    player.board.shift();
    const row = Array.from({ length: COLS }, () => 8 as Cell);
    row[gap] = 0;
    player.board.push(row);
  }
}

function deliverGarbage(sender: PlayerState, target: PlayerState, lines: number): GarbageSend | null {
  if (lines <= 0 || sender.id === target.id || sender.ko || target.ko) return null;
  sender.lastSent += lines;
  target.lastReceived += lines;
  target.pendingGarbage = 0;
  addGarbage(target, lines);
  return { from: sender.id, to: target.id, lines };
}

function locksAboveTop(player: PlayerState): boolean {
  const shape = shapeFor(player.piece, player.rot);
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c] && player.y + r < 0) return true;
    }
  }
  return false;
}

function linesToGarbage(cleared: number): number {
  if (cleared <= 0) return 0;
  if (cleared === 1) return 1;
  return cleared + 1;
}

function chooseTarget(player: PlayerState, players: PlayerState[], humanTarget: PlayerId): PlayerState | undefined {
  if (player.id === 'p1') {
    return players.find(p => p.id === humanTarget && !p.ko);
  }
  return players
    .filter(p => p.id !== player.id && !p.ko)
    .sort((a, b) => b.score + b.pendingGarbage * 50 - (a.score + a.pendingGarbage * 50))[0];
}

function applyAi(player: PlayerState): PlayerState {
  const next = clonePlayer(player);
  if (!next.aiTarget) {
    next.aiTarget = findAiTarget(next);
  }
  if (next.rot !== next.aiTarget.rot) {
    return rotate(next);
  }
  if (next.x < next.aiTarget.x) return move(next, 1);
  if (next.x > next.aiTarget.x) return move(next, -1);
  return next;
}

function findAiTarget(player: PlayerState): { x: number; rot: number } {
  let best = { x: player.x, rot: player.rot, score: -Infinity };
  for (let rot = 0; rot < 4; rot++) {
    const shape = shapeFor(player.piece, rot);
    const width = shape[0].length;
    for (let x = -1; x <= COLS - width + 1; x++) {
      let y = player.y;
      while (!collides(player.board, player.piece, x, y + 1, rot)) y++;
      if (collides(player.board, player.piece, x, y, rot)) continue;
      const score = evaluatePlacement(player, x, y, rot);
      if (score > best.score) best = { x, rot, score };
    }
  }
  return { x: best.x, rot: best.rot };
}

function evaluatePlacement(player: PlayerState, x: number, y: number, rot: number): number {
  const board = player.board.map(row => [...row] as Cell[]);
  const shape = shapeFor(player.piece, rot);
  const color = (PIECE_NAMES.indexOf(player.piece) + 1) as Cell;
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const gy = y + r;
      const gx = x + c;
      if (gy >= 0 && gy < ROWS && gx >= 0 && gx < COLS) {
        board[gy][gx] = color;
      }
    }
  }

  const clears = board.filter(row => row.every(cell => cell !== 0)).length;
  let holes = 0;
  let height = 0;
  for (let c = 0; c < COLS; c++) {
    let seenBlock = false;
    for (let r = 0; r < ROWS; r++) {
      if (board[r][c] !== 0) {
        seenBlock = true;
        height = Math.max(height, ROWS - r);
      } else if (seenBlock) {
        holes++;
      }
    }
  }
  return clears * 120 - holes * 35 - height * 4 + y * 2;
}
