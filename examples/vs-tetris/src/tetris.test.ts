import { describe, expect, it } from 'vitest';
import { advanceArena, garbageFromClearedLines, hardDrop, resetPlayers, sendManualGarbage } from './tetris';

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

  it('knocks out a player when a piece locks above the visible board', () => {
    const [human] = resetPlayers();
    human.board[0] = human.board[0].map(() => 1);

    const result = hardDrop(human);

    expect(result.ko).toBe(true);
  });
});
