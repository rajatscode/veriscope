import { CircuitGraph, assertAfter, assertOperationStatus, type OperationStatus } from '@veriscope/graph';
import {
  DEFAULT_OPPONENTS,
  ROWS,
  clampOpponentCount,
  leaderId,
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

export const GARBAGE_RELAY_OUTCOMES = ['resolved', 'rejected', 'aborted', 'timeout', 'stale'] as const satisfies OperationStatus[];
export const GARBAGE_RELAY_STATUSES = [
  'idle',
  'pending',
  'delivered',
  'failed',
  'aborted',
  'timeout',
  'ignored-stale',
] as const;
export type GarbageRelayStatus = (typeof GARBAGE_RELAY_STATUSES)[number];

const PLAYER_METRICS = [
  'score',
  'lines',
  'pendingGarbage',
  'lastSent',
  'lastReceived',
  'stackHeight',
  'alive',
  'ko',
  'koReason',
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

interface TetrisAssertionBindings {
  playersNodeId: string;
  getPlayers: () => PlayerState[];
  startedNodeId: string;
  getStarted: () => boolean;
  pausedNodeId: string;
  getPaused: () => boolean;
  humanTargetNodeId: string;
  getHumanTarget: () => string;
  targetDomain: string[];
  attackBankNodeId: string;
  getAttackBank: () => number;
  leaderNodeId: string;
  getLeader: () => string;
  canSend2NodeId: string;
  getCanSend2: () => boolean;
  canSend4NodeId: string;
  getCanSend4: () => boolean;
  garbagePulseNodeId: string;
  getGarbagePulse: () => boolean;
  sendHasRecipientNodeId: string;
  getSendHasRecipient: () => boolean;
  relayStatusNodeId: string;
  getRelayStatus: () => GarbageRelayStatus;
}

export function registerTetrisAssertions(
  targetGraph: CircuitGraph,
  bindings: TetrisAssertionBindings,
): { ids: Record<string, string>; dispose: () => void } {
  const ids: Record<string, string> = {};
  const disposables: string[] = [];
  const targetExploreDomain = representativeDomain(bindings.targetDomain);
  const targetDomainIsPartial = targetExploreDomain.length !== bindings.targetDomain.length;
  const targetDomainReason = targetDomainIsPartial
    ? `large target domain represented by ${targetExploreDomain.join(', ')} for deterministic exploration`
    : undefined;

  const register = (name: string, deps: string[], checkFn: () => boolean) => {
    const id = registerAssertion(targetGraph, name, deps, checkFn);
    ids[name] = id;
    disposables.push(id);
    return id;
  };

  const scoresId = register(
    'scores-and-garbage-nonnegative',
    [bindings.playersNodeId],
    () => safePlayers(bindings.getPlayers()).every(player => player.score >= 0 && player.pendingGarbage >= 0),
  );
  targetGraph.setAssertionMetadata(scoresId, {
    checkDeps: [bindings.playersNodeId],
    partial: true,
    reason: 'checks full PlayerState arrays observed through arena.players; scalar controls are enumerated separately',
  });

  const targetId = register(
    'human-target-domain-valid',
    [bindings.humanTargetNodeId],
    () => bindings.targetDomain.includes(bindings.getHumanTarget()) && bindings.getHumanTarget() !== 'p1',
  );
  targetGraph.setAssertionMetadata(targetId, {
    checkDeps: [bindings.humanTargetNodeId],
    domains: {
      [bindings.humanTargetNodeId]: targetExploreDomain,
      'arena.humanTarget': targetExploreDomain,
    },
    partial: targetDomainIsPartial,
    reason: targetDomainReason,
  });

  const bridgeId = register(
    'control-signal-bridge-consistent',
    [
      bindings.startedNodeId,
      bindings.pausedNodeId,
      bindings.humanTargetNodeId,
      bindings.attackBankNodeId,
      bindings.garbagePulseNodeId,
    ],
    () =>
      targetGraph.getNode(bindings.startedNodeId)?.getValue?.() === bindings.getStarted()
      && targetGraph.getNode(bindings.pausedNodeId)?.getValue?.() === bindings.getPaused()
      && targetGraph.getNode(bindings.humanTargetNodeId)?.getValue?.() === bindings.getHumanTarget()
      && targetGraph.getNode(bindings.attackBankNodeId)?.getValue?.() === bindings.getAttackBank()
      && targetGraph.getNode(bindings.garbagePulseNodeId)?.getValue?.() === bindings.getGarbagePulse(),
  );
  targetGraph.setAssertionMetadata(bridgeId, {
    checkDeps: [
      bindings.startedNodeId,
      bindings.pausedNodeId,
      bindings.humanTargetNodeId,
      bindings.attackBankNodeId,
      bindings.garbagePulseNodeId,
    ],
    domains: {
      [bindings.startedNodeId]: [false, true],
      'arena.started': [false, true],
      [bindings.pausedNodeId]: [false, true],
      'arena.paused': [false, true],
      [bindings.humanTargetNodeId]: targetExploreDomain,
      'arena.humanTarget': targetExploreDomain,
      [bindings.attackBankNodeId]: [0, 1, 2, 4],
      'p1.attackBank': [0, 1, 2, 4],
      [bindings.garbagePulseNodeId]: [false],
      'arena.garbagePulse': [false],
    },
    partial: targetDomainIsPartial,
    reason: targetDomainReason,
  });

  const garbageId = register(
    'garbage-queue-bounded',
    [bindings.playersNodeId],
    () => safePlayers(bindings.getPlayers()).every(player => player.pendingGarbage <= 20),
  );
  targetGraph.setAssertionMetadata(garbageId, {
    checkDeps: [bindings.playersNodeId],
    partial: true,
    reason: 'checks full PlayerState arrays observed through arena.players; finite scalar controls are enumerated separately',
  });

  const bankId = register(
    'attack-bank-gates-send-buttons',
    [bindings.canSend2NodeId, bindings.canSend4NodeId, bindings.attackBankNodeId],
    () =>
      (!bindings.getCanSend2() || bindings.getAttackBank() >= 2)
      && (!bindings.getCanSend4() || bindings.getAttackBank() >= 4),
  );
  targetGraph.setAssertionMetadata(bankId, {
    checkDeps: [bindings.canSend2NodeId, bindings.canSend4NodeId, bindings.attackBankNodeId],
    domains: {
      [bindings.attackBankNodeId]: [0, 1, 2, 4],
      'p1.attackBank': [0, 1, 2, 4],
    },
    partial: false,
  });

  const availabilityId = register(
    'send-button-availability-exact',
    [
      bindings.playersNodeId,
      bindings.startedNodeId,
      bindings.pausedNodeId,
      bindings.humanTargetNodeId,
      bindings.attackBankNodeId,
      bindings.canSend2NodeId,
      bindings.canSend4NodeId,
    ],
    () => {
      const players = safePlayers(bindings.getPlayers());
      const target = players.find(player => player.id === bindings.getHumanTarget());
      const human = players.find(player => player.id === 'p1');
      const base =
        bindings.getStarted()
        && !bindings.getPaused()
        && bindings.targetDomain.includes(bindings.getHumanTarget())
        && Boolean(target && !target.ko)
        && Boolean(human && !human.ko);
      return bindings.getCanSend2() === (base && bindings.getAttackBank() >= 2)
        && bindings.getCanSend4() === (base && bindings.getAttackBank() >= 4);
    },
  );
  targetGraph.setAssertionMetadata(availabilityId, {
    checkDeps: [
      bindings.playersNodeId,
      bindings.startedNodeId,
      bindings.pausedNodeId,
      bindings.humanTargetNodeId,
      bindings.attackBankNodeId,
      bindings.canSend2NodeId,
      bindings.canSend4NodeId,
    ],
    domains: {
      [bindings.startedNodeId]: [false, true],
      'arena.started': [false, true],
      [bindings.pausedNodeId]: [false, true],
      'arena.paused': [false, true],
      [bindings.humanTargetNodeId]: targetExploreDomain,
      'arena.humanTarget': targetExploreDomain,
      [bindings.attackBankNodeId]: [0, 1, 2, 4],
      'p1.attackBank': [0, 1, 2, 4],
    },
    partial: true,
    reason: 'checks exact button availability against the current PlayerState array; scalar controls are enumerated',
  });

  const leaderIdAssertion = register(
    'leader-is-active-highest-score',
    [bindings.playersNodeId, bindings.leaderNodeId],
    () => {
      const players = safePlayers(bindings.getPlayers());
      const active = players.filter(player => !player.ko);
      if (active.length === 0) return true;
      const leader = active.find(player => player.id === bindings.getLeader());
      if (!leader) return false;
      const highScore = Math.max(...active.map(player => player.score));
      return leader.score === highScore;
    },
  );
  targetGraph.setAssertionMetadata(leaderIdAssertion, {
    checkDeps: [bindings.playersNodeId, bindings.leaderNodeId],
    partial: true,
    reason: 'checks leader projection over observed PlayerState arrays',
  });

  const pulseId = register(
    'garbage-pulse-has-recipient',
    [bindings.garbagePulseNodeId, bindings.sendHasRecipientNodeId],
    () => !bindings.getGarbagePulse() || bindings.getSendHasRecipient(),
  );
  targetGraph.setAssertionMetadata(pulseId, {
    checkDeps: [bindings.garbagePulseNodeId, bindings.sendHasRecipientNodeId],
    domains: {
      [bindings.garbagePulseNodeId]: [false],
      'arena.garbagePulse': [false],
    },
    partial: true,
    reason: 'recipient state is derived from arena.players; the trigger signal is enumerated',
  });

  const recipientProjectionId = register(
    'recipient-projection-matches-players',
    [bindings.playersNodeId, bindings.sendHasRecipientNodeId],
    () => {
      const expected = safePlayers(bindings.getPlayers()).some(player =>
        player.pendingGarbage > 0 || player.lastReceived > 0,
      );
      return bindings.getSendHasRecipient() === expected;
    },
  );
  targetGraph.setAssertionMetadata(recipientProjectionId, {
    checkDeps: [bindings.playersNodeId, bindings.sendHasRecipientNodeId],
    partial: true,
    reason: 'checks the recipient projection against the observed PlayerState array',
  });

  const temporalDeliveryId = assertAfter(
    { nodeId: bindings.garbagePulseNodeId },
    'posedge',
    'eventually',
    () => bindings.getSendHasRecipient(),
    {
      name: 'after-garbage-pulse-recipient-eventually-visible',
      checkDeps: [bindings.sendHasRecipientNodeId],
      domains: {
        [bindings.garbagePulseNodeId]: [false],
        'arena.garbagePulse': [false, true],
      },
      partial: true,
      reason: 'demonstrates temporal after/eventually semantics over the garbage send pulse',
    },
    targetGraph,
  );
  ids['after-garbage-pulse-recipient-eventually-visible'] = temporalDeliveryId;
  disposables.push(temporalDeliveryId);

  const neverSendWithoutBankId = registerTemporalAssertion(
    targetGraph,
    'never-can-send-with-empty-bank',
    [bindings.canSend2NodeId, bindings.canSend4NodeId, bindings.attackBankNodeId],
    'never',
    () => !(bindings.getAttackBank() === 0 && (bindings.getCanSend2() || bindings.getCanSend4())),
  );
  targetGraph.setAssertionMetadata(neverSendWithoutBankId, {
    checkDeps: [bindings.canSend2NodeId, bindings.canSend4NodeId, bindings.attackBankNodeId],
    domains: {
      [bindings.attackBankNodeId]: [0, 2, 4],
      'p1.attackBank': [0, 2, 4],
    },
    partial: false,
  });
  ids['never-can-send-with-empty-bank'] = neverSendWithoutBankId;
  disposables.push(neverSendWithoutBankId);

  const koReasonId = register(
    'ko-has-valid-reason',
    [bindings.playersNodeId],
    () =>
      safePlayers(bindings.getPlayers()).every(player =>
        !player.ko || player.koReason === 'spawn-blocked' || player.koReason === 'garbage-overflow',
      ),
  );
  targetGraph.setAssertionMetadata(koReasonId, {
    checkDeps: [bindings.playersNodeId],
    partial: true,
    reason: 'checks every KO comes from an explicit engine top-out reason rather than an unexplained state flip',
  });

  const relayStatusId = register(
    'garbage-relay-outcome-visible',
    [bindings.relayStatusNodeId],
    () => GARBAGE_RELAY_STATUSES.includes(bindings.getRelayStatus()),
  );
  targetGraph.setAssertionMetadata(relayStatusId, {
    checkDeps: [bindings.relayStatusNodeId],
    domains: {
      [bindings.relayStatusNodeId]: [...GARBAGE_RELAY_STATUSES],
      'external.garbageRelayStatus': [...GARBAGE_RELAY_STATUSES],
    },
    operationDomains: {
      'garbage-relay': [...GARBAGE_RELAY_OUTCOMES],
    },
    partial: false,
  });

  const terminalOutcomeId = assertOperationStatus(
    'garbage-relay',
    [...GARBAGE_RELAY_OUTCOMES],
    'garbage-relay-terminal-outcome-known',
    targetGraph,
  );
  ids['garbage-relay-terminal-outcome-known'] = terminalOutcomeId;
  disposables.push(terminalOutcomeId);

  const staleHandlingId = register(
    'stale-garbage-relay-does-not-deliver',
    [bindings.relayStatusNodeId],
    () =>
      targetGraph
        .getOperations()
        .filter(op => op.name === 'garbage-relay' && op.status === 'stale')
        .every(() => bindings.getRelayStatus() === 'ignored-stale'),
  );
  targetGraph.setAssertionMetadata(staleHandlingId, {
    checkDeps: [bindings.relayStatusNodeId],
    domains: {
      [bindings.relayStatusNodeId]: [...GARBAGE_RELAY_STATUSES],
      'external.garbageRelayStatus': [...GARBAGE_RELAY_STATUSES],
    },
    operationDomains: {
      'garbage-relay': [...GARBAGE_RELAY_OUTCOMES],
    },
    partial: false,
  });

  return {
    ids,
    dispose() {
      for (const id of disposables) targetGraph.disposeNode(id);
    },
  };
}

export function createVsTetrisGraph(
  opponentCount: OpponentCount = DEFAULT_OPPONENTS,
  options?: { instrumentationEnabled?: boolean },
): CircuitGraph {
  const targetGraph = new CircuitGraph();
  if (options?.instrumentationEnabled === false) {
    targetGraph.disableInstrumentation();
  }

  const count = clampOpponentCount(opponentCount);
  const targetDomain = targetIdsFor(count);
  let players = resetPlayers(count);
  let started = true;
  let paused = false;
  let humanTarget = targetDomain[0] ?? 'p2';
  let attackBank = 0;
  let garbagePulse = false;
  let relayStatus: GarbageRelayStatus = 'idle';

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
  const relayStatusSignal = registerSignal(
    targetGraph,
    'external.garbageRelayStatus',
    () => relayStatus,
    next => {
      relayStatus = GARBAGE_RELAY_STATUSES.includes(next as GarbageRelayStatus)
        ? next as GarbageRelayStatus
        : relayStatus;
    },
    { states: [...GARBAGE_RELAY_STATUSES] },
  );

  const telemetry = registerTetrisTelemetry(targetGraph, playersSignal.id, () => players);

  const targetAlive = registerDerived(targetGraph, 'arena.targetAlive', [playersSignal.id, targetSignal.id], () => {
    const target = players.find(player => player.id === humanTarget);
    return Boolean(target && !target.ko);
  });
  const humanAlive = registerDerived(targetGraph, 'p1.aliveForAttack', [playersSignal.id], () => {
    const human = players.find(player => player.id === 'p1');
    return Boolean(human && !human.ko);
  });
  registerDerived(targetGraph, 'arena.activePlayersForTests', [playersSignal.id], () =>
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
  const sendHasRecipient = registerDerived(
    targetGraph,
    'arena.garbageSendHasRecipient',
    [playersSignal.id, telemetry.ids['arena.anyGarbageQueued'], telemetry.ids['arena.anyRecipientReceived']],
    () =>
      targetGraph.getNode(telemetry.ids['arena.anyGarbageQueued'])?.getValue?.() === true
      || targetGraph.getNode(telemetry.ids['arena.anyRecipientReceived'])?.getValue?.() === true,
  );
  const leader = registerDerived(targetGraph, 'arena.leader', [playersSignal.id], () => leaderId(players));

  targetGraph.registerOperationModel({
    name: 'garbage-relay',
    outcomes: [...GARBAGE_RELAY_OUTCOMES],
    triggerDeps: [bankSignal.id, targetSignal.id],
    outputDeps: [relayStatusSignal.id, playersSignal.id],
    metadata: {
      description: 'simulated external service that acknowledges manual garbage delivery',
      outcomeDomain: [...GARBAGE_RELAY_OUTCOMES],
    },
    handleOutcome: (outcome, { graph }) => {
      graph.driveNodeValue(relayStatusSignal.id, relayStatusForOutcome(outcome));
    },
  });

  registerTetrisAssertions(targetGraph, {
    playersNodeId: playersSignal.id,
    getPlayers: () => players,
    startedNodeId: startedSignal.id,
    getStarted: () => started,
    pausedNodeId: pausedSignal.id,
    getPaused: () => paused,
    humanTargetNodeId: targetSignal.id,
    getHumanTarget: () => humanTarget,
    targetDomain,
    attackBankNodeId: bankSignal.id,
    getAttackBank: () => attackBank,
    leaderNodeId: leader,
    getLeader: () => targetGraph.getNode(leader)?.getValue?.() as string,
    canSend2NodeId: canSend2,
    getCanSend2: () => targetGraph.getNode(canSend2)?.getValue?.() === true,
    canSend4NodeId: canSend4,
    getCanSend4: () => targetGraph.getNode(canSend4)?.getValue?.() === true,
    garbagePulseNodeId: pulseSignal.id,
    getGarbagePulse: () => garbagePulse,
    sendHasRecipientNodeId: sendHasRecipient,
    getSendHasRecipient: () => targetGraph.getNode(sendHasRecipient)?.getValue?.() === true,
    relayStatusNodeId: relayStatusSignal.id,
    getRelayStatus: () => relayStatus,
  });

  targetGraph.propagate();
  return targetGraph;
}

function registerSignal<T>(
  targetGraph: CircuitGraph,
  name: string,
  get: () => T,
  set: (next: T) => void,
  options?: { states?: string[] },
): SignalStore<T> {
  const id = targetGraph.registerNode({
    name,
    type: 'signal',
    stablePath: name,
    metadata: options?.states ? { states: options.states } : undefined,
  });
  targetGraph.setNodeValue(id, get);
  targetGraph.setNodeSetter(id, set);
  return { id, get, set };
}

export function relayStatusForOutcome(outcome: OperationStatus): GarbageRelayStatus {
  if (outcome === 'resolved') return 'delivered';
  if (outcome === 'rejected') return 'failed';
  if (outcome === 'aborted') return 'aborted';
  if (outcome === 'timeout') return 'timeout';
  if (outcome === 'stale') return 'ignored-stale';
  return 'pending';
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

function registerTemporalAssertion(
  targetGraph: CircuitGraph,
  name: string,
  deps: string[],
  kind: 'after' | 'never',
  checkFn: () => boolean,
): string {
  const id = targetGraph.registerNode({ name, type: 'assertion', deps, stablePath: name });
  targetGraph.setAssertionFn(id, checkFn, kind === 'after' ? 'after' : 'never');
  return id;
}

function representativeDomain<T>(values: T[]): T[] {
  if (values.length <= 6) return [...values];
  const indexes = [0, 1, Math.floor((values.length - 1) / 2), values.length - 1];
  const result: T[] = [];
  for (const index of indexes) {
    const value = values[index];
    if (!result.some(existing => Object.is(existing, value))) result.push(value);
  }
  return result;
}

function safePlayers(value: PlayerState[] | unknown): PlayerState[] {
  return Array.isArray(value) ? value : [];
}

function playerMetric(player: PlayerState | undefined, metric: (typeof PLAYER_METRICS)[number]): string | number | boolean {
  if (!player) {
    if (metric === 'alive') return false;
    if (metric === 'ko') return true;
    if (metric === 'koReason') return 'missing';
    if (metric === 'piece') return 'none';
    return 0;
  }

  if (metric === 'stackHeight') return stackHeight(player);
  if (metric === 'alive') return !player.ko;
  if (metric === 'koReason') return player.koReason ?? 'none';
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
