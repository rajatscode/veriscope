import { CircuitGraph } from '@veriscope/graph';
import {
  DEFAULT_OPPONENTS,
  ROWS,
  clampOpponentCount,
  resetPlayers,
  targetIdsFor,
  type OpponentCount,
  type PlayerState,
} from './tetris';

type SignalStore<T> = {
  get: () => T;
  set: (next: T) => void;
  id: string;
};

const PLAYER_METRICS = [
  'score',
  'lines',
  'pendingGarbage',
  'lastSent',
  'lastReceived',
  'stackHeight',
  'alive',
  'ko',
  'piece',
] as const;

export function registerTetrisTelemetry(
  targetGraph: CircuitGraph,
  playersNodeId: string,
  getPlayers: () => PlayerState[],
): { ids: Record<string, string>; dispose: () => void } {
  const ids: Record<string, string> = {};
  const disposables: string[] = [];
  const players = safePlayers(getPlayers());

  const register = (name: string, computeFn: () => unknown, deps = [playersNodeId]) => {
    const id = targetGraph.registerNode({
      name,
      type: 'derived',
      deps,
      stablePath: name,
      computeFn,
    });
    ids[name] = id;
    disposables.push(id);
    return id;
  };

  register('arena.koCount', () => safePlayers(getPlayers()).filter(player => player.ko).length);
  register('arena.totalSent', () => safePlayers(getPlayers()).reduce((sum, player) => sum + player.lastSent, 0));
  register('arena.totalReceived', () => safePlayers(getPlayers()).reduce((sum, player) => sum + player.lastReceived, 0));
  register('arena.maxStackHeight', () => safePlayers(getPlayers()).reduce((max, player) => Math.max(max, stackHeight(player)), 0));
  register('arena.anyGarbageQueued', () => safePlayers(getPlayers()).some(player => player.pendingGarbage > 0));
  register('arena.anyRecipientReceived', () => safePlayers(getPlayers()).some(player => player.lastReceived > 0));
  register('arena.scoresAndGarbageNonnegative', () =>
    safePlayers(getPlayers()).every(player => player.score >= 0 && player.pendingGarbage >= 0),
  );
  register('arena.garbageQueuesBounded', () => safePlayers(getPlayers()).every(player => player.pendingGarbage <= 20));

  for (const player of players) {
    const playerId = player.id;
    for (const metric of PLAYER_METRICS) {
      const name = `${playerId}.${metric}`;
      register(name, () => playerMetric(safePlayers(getPlayers()).find(entry => entry.id === playerId), metric));
    }
  }

  return {
    ids,
    dispose() {
      for (const id of disposables) targetGraph.disposeNode(id);
    },
  };
}

export function createVsTetrisGraph(opponentCount: OpponentCount = DEFAULT_OPPONENTS): CircuitGraph {
  const targetGraph = new CircuitGraph();
  const count = clampOpponentCount(opponentCount);
  const targetDomain = targetIdsFor(count);
  let players = resetPlayers(count);
  let started = true;
  let paused = false;
  let humanTarget = targetDomain[0] ?? 'p2';
  let attackBank = 0;
  let garbagePulse = false;

  const playersSignal = registerSignal(targetGraph, 'arena.players', () => players, next => {
    players = Array.isArray(next) ? next : players;
  });
  const startedSignal = registerSignal(targetGraph, 'arena.started', () => started, next => {
    started = Boolean(next);
  });
  const pausedSignal = registerSignal(targetGraph, 'arena.paused', () => paused, next => {
    paused = Boolean(next);
  });
  const targetSignal = registerSignal(targetGraph, 'arena.humanTarget', () => humanTarget, next => {
    humanTarget = typeof next === 'string' ? next : humanTarget;
  });
  const bankSignal = registerSignal(targetGraph, 'p1.attackBank', () => attackBank, next => {
    attackBank = Number.isFinite(Number(next)) ? Number(next) : attackBank;
  });
  const pulseSignal = registerSignal(targetGraph, 'arena.garbagePulse', () => garbagePulse, next => {
    garbagePulse = Boolean(next);
  });

  const telemetry = registerTetrisTelemetry(targetGraph, playersSignal.id, () => players);

  const targetAlive = registerDerived(targetGraph, 'arena.targetAlive', [playersSignal.id, targetSignal.id], () => {
    const target = players.find(player => player.id === humanTarget);
    return Boolean(target && !target.ko);
  });
  const humanAlive = registerDerived(targetGraph, 'p1.aliveForAttack', [playersSignal.id], () => {
    const human = players.find(player => player.id === 'p1');
    return Boolean(human && !human.ko);
  });
  const activePlayers = registerDerived(targetGraph, 'arena.activePlayersForTests', [playersSignal.id], () =>
    players.filter(player => !player.ko).length,
  );
  const canSend2 = registerDerived(
    targetGraph,
    'p1.canSend2',
    [startedSignal.id, pausedSignal.id, bankSignal.id, targetSignal.id, targetAlive, humanAlive],
    () => started && !paused && attackBank >= 2 && targetDomain.includes(humanTarget) && targetGraph.getNode(targetAlive)?.getValue?.() === true && targetGraph.getNode(humanAlive)?.getValue?.() === true,
  );
  const canSend4 = registerDerived(
    targetGraph,
    'p1.canSend4',
    [startedSignal.id, pausedSignal.id, bankSignal.id, targetSignal.id, targetAlive, humanAlive],
    () => started && !paused && attackBank >= 4 && targetDomain.includes(humanTarget) && targetGraph.getNode(targetAlive)?.getValue?.() === true && targetGraph.getNode(humanAlive)?.getValue?.() === true,
  );

  const targetAssertion = registerAssertion(targetGraph, 'human-target-domain-valid', [targetSignal.id], () =>
    targetDomain.includes(humanTarget) && humanTarget !== 'p1',
  );
  targetGraph.setAssertionMetadata(targetAssertion, {
    checkDeps: [targetSignal.id],
    domains: { [targetSignal.id]: targetDomain, 'arena.humanTarget': targetDomain },
    partial: false,
  });

  const bankAssertion = registerAssertion(targetGraph, 'attack-bank-gates-send-buttons', [bankSignal.id, canSend2, canSend4], () =>
    (!targetGraph.getNode(canSend2)?.getValue?.() || attackBank >= 2)
    && (!targetGraph.getNode(canSend4)?.getValue?.() || attackBank >= 4),
  );
  targetGraph.setAssertionMetadata(bankAssertion, {
    checkDeps: [bankSignal.id, canSend2, canSend4],
    domains: { [bankSignal.id]: [0, 1, 2, 4], 'p1.attackBank': [0, 1, 2, 4] },
    partial: false,
  });

  const pulseAssertion = registerAssertion(
    targetGraph,
    'garbage-pulse-has-recipient',
    [pulseSignal.id, telemetry.ids['arena.anyGarbageQueued'], telemetry.ids['arena.anyRecipientReceived']],
    () => !garbagePulse
      || targetGraph.getNode(telemetry.ids['arena.anyGarbageQueued'])?.getValue?.() === true
      || targetGraph.getNode(telemetry.ids['arena.anyRecipientReceived'])?.getValue?.() === true,
  );
  targetGraph.setAssertionMetadata(pulseAssertion, {
    checkDeps: [pulseSignal.id, telemetry.ids['arena.anyGarbageQueued'], telemetry.ids['arena.anyRecipientReceived']],
    domains: { [pulseSignal.id]: [false], 'arena.garbagePulse': [false] },
    partial: true,
    reason: 'recipient state is derived from arena.players, which is explored only through declared domain cases',
  });

  const integrityAssertion = registerAssertion(
    targetGraph,
    'tetris-player-state-integrity',
    [telemetry.ids['arena.scoresAndGarbageNonnegative'], telemetry.ids['arena.garbageQueuesBounded'], activePlayers],
    () =>
      targetGraph.getNode(telemetry.ids['arena.scoresAndGarbageNonnegative'])?.getValue?.() === true
      && targetGraph.getNode(telemetry.ids['arena.garbageQueuesBounded'])?.getValue?.() === true
      && Number(targetGraph.getNode(activePlayers)?.getValue?.() ?? 0) >= 1,
  );
  targetGraph.setAssertionMetadata(integrityAssertion, {
    checkDeps: [telemetry.ids['arena.scoresAndGarbageNonnegative'], telemetry.ids['arena.garbageQueuesBounded'], activePlayers],
    partial: true,
    reason: 'full board arrays are observed and derived; finite scalar controls are enumerated',
  });

  targetGraph.propagate();
  return targetGraph;
}

function registerSignal<T>(
  targetGraph: CircuitGraph,
  name: string,
  get: () => T,
  set: (next: T) => void,
): SignalStore<T> {
  const id = targetGraph.registerNode({ name, type: 'signal', stablePath: name });
  targetGraph.setNodeValue(id, get);
  targetGraph.setNodeSetter(id, set);
  return { id, get, set };
}

function registerDerived(
  targetGraph: CircuitGraph,
  name: string,
  deps: string[],
  computeFn: () => unknown,
): string {
  return targetGraph.registerNode({
    name,
    type: 'derived',
    deps,
    stablePath: name,
    computeFn,
  });
}

function registerAssertion(
  targetGraph: CircuitGraph,
  name: string,
  deps: string[],
  checkFn: () => boolean,
): string {
  const id = targetGraph.registerNode({ name, type: 'assertion', deps, stablePath: name });
  targetGraph.setAssertionFn(id, checkFn, 'always');
  return id;
}

function safePlayers(value: PlayerState[] | unknown): PlayerState[] {
  return Array.isArray(value) ? value : [];
}

function playerMetric(player: PlayerState | undefined, metric: (typeof PLAYER_METRICS)[number]): string | number | boolean {
  if (!player) {
    if (metric === 'alive') return false;
    if (metric === 'ko') return true;
    if (metric === 'piece') return 'none';
    return 0;
  }

  if (metric === 'stackHeight') return stackHeight(player);
  if (metric === 'alive') return !player.ko;
  return player[metric];
}

function stackHeight(player: PlayerState): number {
  for (let row = 0; row < player.board.length; row++) {
    if (player.board[row].some(cell => cell !== 0)) {
      return ROWS - row;
    }
  }
  return 0;
}
