import { describe, expect, it } from 'vitest';
import { mutate } from '@veriscope/mutate';
import { runAutotest } from '@veriscope/test';
import { advanceArena, garbageFromClearedLines, hardDrop, resetPlayers, sendManualGarbage } from './tetris';
import { createVsTetrisGraph } from './veriscopeTetris';

describe('vs-tetris engine', () => {
  it('creates one human and three AI players', () => {
    const players = resetPlayers();

    expect(players).toHaveLength(4);
    expect(players[0].kind).toBe('human');
    expect(players.slice(1).every(player => player.kind === 'ai')).toBe(true);
  });

  it('can create a smaller opponent field', () => {
    const players = resetPlayers(1);

    expect(players.map(player => player.id)).toEqual(['p1', 'p2']);
    expect(players[1].name).toBe('AI 1');
  });

  it('can create a large opponent field', () => {
    const players = resetPlayers(99);
    const last = players[players.length - 1];

    expect(players).toHaveLength(100);
    expect(last.id).toBe('p100');
    expect(last.name).toBe('AI 99');
  });

  it('routes manual human garbage to the selected target', () => {
    const players = resetPlayers();
    const result = sendManualGarbage(players, 'p1', 'p3', 4);
    const target = result.players.find(player => player.id === 'p3')!;
    const sender = result.players.find(player => player.id === 'p1')!;

    expect(result.sends).toEqual([{ from: 'p1', to: 'p3', lines: 4 }]);
    expect(target.pendingGarbage).toBe(0);
    expect(target.lastReceived).toBe(4);
    expect(sender.lastSent).toBe(4);
    expect(target.board.filter(row => row.some(cell => cell === 8))).toHaveLength(4);
  });

  it('applies repeated manual sends immediately', () => {
    const players = resetPlayers();
    const first = sendManualGarbage(players, 'p1', 'p2', 2);
    const second = sendManualGarbage(first.players, 'p1', 'p2', 2);
    const target = second.players.find(player => player.id === 'p2')!;
    const sender = second.players.find(player => player.id === 'p1')!;

    expect(second.sends).toEqual([{ from: 'p1', to: 'p2', lines: 2 }]);
    expect(sender.lastSent).toBe(4);
    expect(target.lastReceived).toBe(4);
    expect(target.board.filter(row => row.some(cell => cell === 8))).toHaveLength(4);
  });

  it('does not route garbage to self', () => {
    const players = resetPlayers();
    const result = sendManualGarbage(players, 'p1', 'p1', 2);

    expect(result.sends).toHaveLength(0);
    expect(result.players.find(player => player.id === 'p1')!.pendingGarbage).toBe(0);
  });

  it('can hold human line clears as earned attack instead of auto-sending', () => {
    const players = resetPlayers();
    players[0].lastCleared = 2;
    const earned = garbageFromClearedLines(players[0].lastCleared);

    expect(earned).toBe(3);
  });

  it('advances all players as one arena tick', () => {
    const players = resetPlayers(2);
    const result = advanceArena(players, 'p2');

    expect(result.players).toHaveLength(3);
    expect(result.players.every(player => player.y >= -2)).toBe(true);
  });

  it('knocks out a player with an explicit reason when the spawn area is blocked', () => {
    const [human] = resetPlayers();
    human.nextPiece = 'O';
    human.board[0][3] = 1;

    const result = hardDrop(human);

    expect(result.ko).toBe(true);
    expect(result.koReason).toBe('spawn-blocked');
  });

  it('exposes Tetris state to Veriscope autotest as scalar graph nodes and generated cases', async () => {
    const graph = createVsTetrisGraph(2);
    const names = graph.getNodes().map(node => node.name);

    expect(names).toContain('p1.score');
    expect(names).toContain('p2.pendingGarbage');
    expect(names).toContain('arena.maxStackHeight');
    expect(names).toContain('p1.canSend2');

    const result = await runAutotest(graph, { budget: 400, name: 'vs-tetris-autotest' });

    expect(result.scenarios.length).toBeGreaterThan(0);
    expect(result.scenarios.some(scenario => scenario.steps.length > 0)).toBe(true);
    expect(result.coverage.overall.total).toBeGreaterThan(0);
    expect(result.assertions.some(assertion => assertion.partialCoverage)).toBe(true);
    expect(result.assertions.every(assertion => assertion.exercised)).toBe(true);
    expect(result.assertions.every(assertion => assertion.status === 'passed')).toBe(true);
    expect(result.assertions.every(assertion => assertion.passScenarioCount + assertion.failScenarioCount > 0)).toBe(true);
    expect(result.assertions.map(assertion => assertion.name)).toEqual([
      'scores-and-garbage-nonnegative',
      'human-target-domain-valid',
      'control-signal-bridge-consistent',
      'garbage-queue-bounded',
      'attack-bank-gates-send-buttons',
      'send-button-availability-exact',
      'garbage-pulse-has-recipient',
      'recipient-projection-matches-players',
      'after-garbage-pulse-recipient-eventually-visible',
      'never-can-send-with-empty-bank',
      'ko-has-valid-reason',
    ]);
    expect(result.assertions.some(assertion => assertion.kind === 'after')).toBe(true);
    expect(result.scenarios.some(scenario => scenario.kind === 'sequence')).toBe(true);
    expect(result.scenarios.some(scenario => scenario.kind === 'coverage-directed')).toBe(true);
    expect(result.scenarios.every(scenario =>
      scenario.steps.every(step => step.signal !== 'p1.attackBank' || typeof step.value !== 'number' || step.value >= 0),
    )).toBe(true);
  });

  it('registers a real mutation target that autotest can kill', async () => {
    const result = await mutate(
      () => createVsTetrisGraph(1),
      { budget: 160, operators: ['constant-fold', 'invert-comparison'] },
    );

    expect(result.total).toBeGreaterThan(0);
    expect(result.killed).toBeGreaterThan(0);
  });
});
