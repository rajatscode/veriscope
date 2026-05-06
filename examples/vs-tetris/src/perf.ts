import { coverage, type CircuitGraph, type GraphNode } from '@veriscope/graph';
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

type PerfMode = 'plain' | 'disabled' | 'dev';

interface ModeRun {
  mode: PerfMode;
  ms: number;
  checksum: string;
  nodeCount: number;
  assertionCount: number;
}

export interface PerfStats {
  medianMs: number;
  p95Ms: number;
  samples: number[];
}

export interface PerfResult {
  opponentCount: OpponentCount;
  iterations: number;
  seed: number;
  sampleCount: number;
  warmupCount: number;
  plain: PerfStats;
  disabled: PerfStats;
  dev: PerfStats;
  disabledRatio: number;
  devRatio: number;
  disabledDeltaPerTickUs: number;
  devDeltaPerTickUs: number;
  disabledWithinNoise: boolean;
  plainChecksum: string;
  disabledChecksum: string;
  veriscopeChecksum: string;
  checksumMatched: boolean;
  disabledNodeCount: number;
  nodeCount: number;
  assertionCount: number;
}

const SAMPLE_COUNT = 9;
const WARMUP_COUNT = 2;
const NOISE_RATIO = 0.05;
const ORDERS: PerfMode[][] = [
  ['plain', 'disabled', 'dev'],
  ['disabled', 'dev', 'plain'],
  ['dev', 'plain', 'disabled'],
];

export function measureVsTetrisPerf(opponentCount: OpponentCount, iterations: number): PerfResult {
  const count = clampOpponentCount(opponentCount);
  const ticks = Math.max(1, Math.floor(iterations));
  const baseSeed = (0x715c0fef ^ (count << 8) ^ ticks) >>> 0;
  const target = targetIdsFor(count)[0] ?? 'p2';
  const savedRng = snapshotTetrisRng();
  const coverageWasEnabled = coverage.isEnabled();

  const measured: Record<PerfMode, ModeRun[]> = {
    plain: [],
    disabled: [],
    dev: [],
  };
  let allChecksumsMatched = true;

  try {
    coverage.disable();

    for (let sample = -WARMUP_COUNT; sample < SAMPLE_COUNT; sample++) {
      const measuredSample = sample >= 0;
      const order = ORDERS[((sample + WARMUP_COUNT) % ORDERS.length + ORDERS.length) % ORDERS.length];
      const seed = sampleSeed(baseSeed, sample);
      const runs = new Map<PerfMode, ModeRun>();

      for (const mode of order) {
        const run = runMode(mode, count, ticks, target, seed);
        runs.set(mode, run);
        if (measuredSample) measured[mode].push(run);
      }

      const plainChecksum = runs.get('plain')?.checksum;
      const disabledChecksum = runs.get('disabled')?.checksum;
      const devChecksum = runs.get('dev')?.checksum;
      allChecksumsMatched &&= plainChecksum === disabledChecksum && plainChecksum === devChecksum;
    }

    const plain = statsFor(measured.plain.map(run => run.ms));
    const disabled = statsFor(measured.disabled.map(run => run.ms));
    const dev = statsFor(measured.dev.map(run => run.ms));
    const disabledRatio = ratio(disabled.medianMs, plain.medianMs);
    const devRatio = ratio(dev.medianMs, plain.medianMs);
    const disabledDeltaPerTickUs = ((disabled.medianMs - plain.medianMs) / ticks) * 1000;
    const devDeltaPerTickUs = ((dev.medianMs - plain.medianMs) / ticks) * 1000;
    const firstPlain = measured.plain[0];
    const firstDisabled = measured.disabled[0];
    const firstDev = measured.dev[0];

    return {
      opponentCount: count,
      iterations: ticks,
      seed: baseSeed,
      sampleCount: SAMPLE_COUNT,
      warmupCount: WARMUP_COUNT,
      plain,
      disabled,
      dev,
      disabledRatio,
      devRatio,
      disabledDeltaPerTickUs,
      devDeltaPerTickUs,
      disabledWithinNoise: disabled.medianMs <= plain.medianMs * (1 + NOISE_RATIO),
      plainChecksum: firstPlain?.checksum ?? '',
      disabledChecksum: firstDisabled?.checksum ?? '',
      veriscopeChecksum: firstDev?.checksum ?? '',
      checksumMatched:
        allChecksumsMatched
        && firstPlain?.checksum === firstDisabled?.checksum
        && firstPlain?.checksum === firstDev?.checksum,
      disabledNodeCount: firstDisabled?.nodeCount ?? 0,
      nodeCount: firstDev?.nodeCount ?? 0,
      assertionCount: firstDev?.assertionCount ?? 0,
    };
  } finally {
    restoreTetrisRng(savedRng);
    if (coverageWasEnabled) coverage.enable();
    else coverage.disable();
  }
}

function runMode(
  mode: PerfMode,
  count: OpponentCount,
  ticks: number,
  target: string,
  seed: number,
): ModeRun {
  if (mode === 'plain') return runPlain(count, ticks, target, seed);
  if (mode === 'disabled') return runDisabled(count, ticks, target, seed);
  return runDev(count, ticks, target, seed);
}

function runPlain(count: OpponentCount, ticks: number, target: string, seed: number): ModeRun {
  resetTetrisRng(seed);
  let players = resetPlayers(count);
  let projectionHash = 0;

  const start = performance.now();
  for (let i = 0; i < ticks; i++) {
    const result = advanceArena(players, target, { holdHumanGarbage: true });
    players = result.players;
    projectionHash = mixHash(projectionHash, readPlainSelectors(players));
  }

  return {
    mode: 'plain',
    ms: performance.now() - start,
    checksum: `${checksumPlayers(players)}:${projectionHash}`,
    nodeCount: 0,
    assertionCount: 0,
  };
}

function runDisabled(count: OpponentCount, ticks: number, target: string, seed: number): ModeRun {
  const disabledGraph = createVsTetrisGraph(count, { instrumentationEnabled: false });
  resetTetrisRng(seed);
  let players = resetPlayers(count);
  let projectionHash = 0;

  const start = performance.now();
  for (let i = 0; i < ticks; i++) {
    const result = advanceArena(players, target, { holdHumanGarbage: true });
    players = result.players;
    projectionHash = mixHash(projectionHash, readPlainSelectors(players));
  }

  return {
    mode: 'disabled',
    ms: performance.now() - start,
    checksum: `${checksumPlayers(players)}:${projectionHash}`,
    nodeCount: disabledGraph.getNodes().length,
    assertionCount: disabledGraph.getAssertions().length,
  };
}

function runDev(count: OpponentCount, ticks: number, target: string, seed: number): ModeRun {
  resetTetrisRng(seed);
  const perfGraph = createVsTetrisGraph(count);
  const playersNode = perfGraph.getNodes().find(node => node.name === 'arena.players');
  if (!playersNode?.setValue) throw new Error('perf graph missing arena.players signal');
  const selectorNodes = selectorNodeMap(perfGraph);

  perfGraph.enterTestMode();
  perfGraph.startRecording();
  let players = playersNode.getValue?.() as PlayerState[];
  let projectionHash = 0;

  const start = performance.now();
  for (let i = 0; i < ticks; i++) {
    const result = advanceArena(players, target, { holdHumanGarbage: true });
    perfGraph.openTick();
    perfGraph.driveNodeValue(playersNode.id, result.players);
    perfGraph.checkAssertions();
    perfGraph.closeTick();
    players = result.players;
    projectionHash = mixHash(projectionHash, readGraphSelectors(selectorNodes));
  }
  const ms = performance.now() - start;

  perfGraph.stopRecording();
  perfGraph.exitTestMode();

  return {
    mode: 'dev',
    ms,
    checksum: `${checksumPlayers(players)}:${projectionHash}`,
    nodeCount: perfGraph.getNodes().length,
    assertionCount: perfGraph.getAssertions().length,
  };
}

function sampleSeed(baseSeed: number, sample: number): number {
  return (baseSeed ^ Math.imul(sample + 0x9e3779b9, 0x85ebca6b)) >>> 0;
}

function statsFor(samples: number[]): PerfStats {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    samples: sorted,
  };
}

function percentile(sortedSamples: number[], p: number): number {
  if (sortedSamples.length === 0) return 0;
  const index = Math.min(sortedSamples.length - 1, Math.max(0, Math.ceil(sortedSamples.length * p) - 1));
  return sortedSamples[index];
}

function ratio(value: number, baseline: number): number {
  return baseline > 0 ? value / baseline : 0;
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

function selectorNodeMap(perfGraph: CircuitGraph): GraphNode[] {
  const nodes = perfGraph.getNodes();
  return [
    'arena.activePlayersForTests',
    'arena.leader',
    'arena.garbageSendHasRecipient',
    'arena.totalSent',
    'arena.totalReceived',
  ].map(name => {
    const node = nodes.find(entry => entry.name === name);
    if (!node?.getValue) throw new Error(`perf graph missing ${name}`);
    return node;
  });
}

function readGraphSelectors(selectorNodes: GraphNode[]): number {
  return hashValues(selectorNodes.map(node => node.getValue?.()));
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
