import { coverage, type CircuitGraph } from '@veriscope/graph';
import {
  advanceArena,
  clampOpponentCount,
  leaderId,
  resetPlayers,
  restoreTetrisRng,
  snapshotTetrisRng,
  targetIdsFor,
  resetTetrisRng,
  type OpponentCount,
  type PlayerState,
} from './tetris';
import { createVsTetrisGraph } from './veriscopeTetris';

export interface PerfResult {
  opponentCount: OpponentCount;
  iterations: number;
  seed: number;
  plainMs: number;
  disabledMs: number;
  veriscopeMs: number;
  disabledRatio: number;
  ratio: number;
  disabledDeltaPerTickUs: number;
  deltaPerTickUs: number;
  plainChecksum: string;
  disabledChecksum: string;
  veriscopeChecksum: string;
  checksumMatched: boolean;
  disabledNodeCount: number;
  nodeCount: number;
  assertionCount: number;
}

export function measureVsTetrisPerf(opponentCount: OpponentCount, iterations: number): PerfResult {
  const count = clampOpponentCount(opponentCount);
  const ticks = Math.max(1, Math.floor(iterations));
  const seed = (0x715c0fef ^ (count << 8) ^ ticks) >>> 0;
  const target = targetIdsFor(count)[0] ?? 'p2';
  const savedRng = snapshotTetrisRng();
  const coverageWasEnabled = coverage.isEnabled();

  try {
    coverage.disable();

    resetTetrisRng(seed);
    let plainPlayers = resetPlayers(count);
    let plainProjectionHash = 0;
    const plainStart = performance.now();
    for (let i = 0; i < ticks; i++) {
      const result = advanceArena(plainPlayers, target, { holdHumanGarbage: true });
      plainPlayers = result.players;
      plainProjectionHash = mixHash(plainProjectionHash, readPlainSelectors(plainPlayers));
    }
    const plainMs = performance.now() - plainStart;
    const plainChecksum = `${checksumPlayers(plainPlayers)}:${plainProjectionHash}`;

    resetTetrisRng(seed);
    const disabledGraph = createVsTetrisGraph(count, { instrumentationEnabled: false });
    resetTetrisRng(seed);
    let disabledPlayers = resetPlayers(count);
    let disabledProjectionHash = 0;
    const disabledStart = performance.now();
    for (let i = 0; i < ticks; i++) {
      const result = advanceArena(disabledPlayers, target, { holdHumanGarbage: true });
      disabledPlayers = result.players;
      disabledProjectionHash = mixHash(disabledProjectionHash, readPlainSelectors(disabledPlayers));
    }
    const disabledMs = performance.now() - disabledStart;
    const disabledChecksum = `${checksumPlayers(disabledPlayers)}:${disabledProjectionHash}`;

    resetTetrisRng(seed);
    const perfGraph = createVsTetrisGraph(count);
    const playersNode = perfGraph.getNodes().find(node => node.name === 'arena.players');
    if (!playersNode?.setValue) throw new Error('perf graph missing arena.players signal');
    perfGraph.enterTestMode();
    perfGraph.startRecording();
    let scopedPlayers = playersNode.getValue?.() as PlayerState[];
    let veriscopeProjectionHash = 0;

    const veriscopeStart = performance.now();
    for (let i = 0; i < ticks; i++) {
      const result = advanceArena(scopedPlayers, target, { holdHumanGarbage: true });
      perfGraph.openTick();
      perfGraph.driveNodeValue(playersNode.id, result.players);
      perfGraph.checkAssertions();
      perfGraph.closeTick();
      scopedPlayers = result.players;
      veriscopeProjectionHash = mixHash(veriscopeProjectionHash, readGraphSelectors(perfGraph));
    }
    const veriscopeMs = performance.now() - veriscopeStart;
    perfGraph.stopRecording();
    perfGraph.exitTestMode();
    const veriscopeChecksum = `${checksumPlayers(scopedPlayers)}:${veriscopeProjectionHash}`;
    const ratio = plainMs > 0 ? veriscopeMs / plainMs : 0;

    return {
      opponentCount: count,
      iterations: ticks,
      seed,
      plainMs,
      disabledMs,
      veriscopeMs,
      disabledRatio: plainMs > 0 ? disabledMs / plainMs : 0,
      ratio,
      disabledDeltaPerTickUs: ((disabledMs - plainMs) / ticks) * 1000,
      deltaPerTickUs: ((veriscopeMs - plainMs) / ticks) * 1000,
      plainChecksum,
      disabledChecksum,
      veriscopeChecksum,
      checksumMatched: plainChecksum === disabledChecksum && plainChecksum === veriscopeChecksum,
      disabledNodeCount: disabledGraph.getNodes().length,
      nodeCount: perfGraph.getNodes().length,
      assertionCount: perfGraph.getAssertions().length,
    };
  } finally {
    restoreTetrisRng(savedRng);
    if (coverageWasEnabled) coverage.enable();
    else coverage.disable();
  }
}

function readPlainSelectors(players: PlayerState[]): number {
  return hashValues([
    players.filter(player => !player.ko).length,
    leaderId(players),
    players.some(player => player.pendingGarbage > 0 || player.lastReceived > 0),
    players.reduce((sum, player) => sum + player.lastSent, 0),
    players.reduce((sum, player) => sum + player.lastReceived, 0),
  ]);
}

function readGraphSelectors(perfGraph: CircuitGraph): number {
  return hashValues([
    nodeValue(perfGraph, 'arena.activePlayersForTests'),
    nodeValue(perfGraph, 'arena.leader'),
    nodeValue(perfGraph, 'arena.garbageSendHasRecipient'),
    nodeValue(perfGraph, 'arena.totalSent'),
    nodeValue(perfGraph, 'arena.totalReceived'),
  ]);
}

function nodeValue(perfGraph: CircuitGraph, name: string): unknown {
  return perfGraph.getNodes().find(node => node.name === name)?.getValue?.();
}

function hashValues(values: unknown[]): number {
  let hash = 2166136261;
  for (const value of values) {
    const text = String(value);
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 31;
  }
  return hash >>> 0;
}

function mixHash(current: number, value: number): number {
  return Math.imul(current ^ value, 16777619) >>> 0;
}

function checksumPlayers(players: PlayerState[]): string {
  let score = 0;
  let lines = 0;
  let garbage = 0;
  let board = 0;
  let ko = 0;
  for (const player of players) {
    score += player.score;
    lines += player.lines;
    garbage += player.pendingGarbage + player.lastReceived + player.lastSent;
    if (player.ko) ko++;
    for (let row = 0; row < player.board.length; row++) {
      for (let col = 0; col < player.board[row].length; col++) {
        board = (board + player.board[row][col] * (row + 1) * (col + 3)) >>> 0;
      }
    }
  }
  return `${players.length}:${score}:${lines}:${garbage}:${ko}:${board}`;
}
