import { useEffect, useMemo, useRef, useState } from 'react';
import {
  COLS,
  PLAYER_IDS,
  ROWS,
  advanceArena,
  garbageFromClearedLines,
  hardDrop,
  move,
  resetPlayers,
  rotate,
  sendManualGarbage,
  shapeFor,
  softDrop,
  type Cell,
  type GarbageSend,
  type PlayerId,
  type PlayerState,
} from '../../tetris';

const TARGETS: PlayerId[] = ['p2', 'p3', 'p4'];

export function PlainReactVsTetris() {
  const initial = useMemo(() => resetPlayers(), []);
  const [players, setPlayers] = useState(initial);
  const [target, setTarget] = useState<PlayerId>('p2');
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const [attack, setAttack] = useState(0);
  const [sendLog, setSendLog] = useState<GarbageSend[]>([]);
  const stepRef = useRef<() => void>(() => {});

  const activePlayers = players.filter(player => !player.ko).length;
  const leader = [...players].sort((a, b) => b.score - a.score)[0].id;
  const winner = activePlayers === 1 ? players.find(player => !player.ko)?.id : null;
  const totalPending = players.reduce((sum, player) => sum + player.pendingGarbage, 0);

  function commit(nextPlayers: PlayerState[], sends: GarbageSend[]) {
    setPlayers(nextPlayers);
    setTick(current => current + 1);
    if (sends.length > 0) {
      setSendLog(previous => [...sends, ...previous].slice(0, 8));
    }
  }

  function step() {
    if (paused || activePlayers <= 1) return;
    const result = advanceArena(players, target, { holdHumanGarbage: true });
    const earned = garbageFromClearedLines(result.players[0].lastCleared);
    commit(result.players, result.sends);
    if (earned > 0) setAttack(current => current + earned);
  }

  function send(lines: number) {
    if (attack < lines) return;
    const recipient = players.find(player => player.id === target);
    if (!recipient || recipient.ko) return;
    const result = sendManualGarbage(players, 'p1', target, lines);
    if (result.sends.length === 0) return;
    setAttack(current => current - lines);
    commit(result.players, result.sends);
  }

  function updateHuman(next: PlayerState) {
    const newlyCleared = Math.max(0, next.lines - players[0].lines);
    const earned = garbageFromClearedLines(newlyCleared);
    setPlayers(current => [next, ...current.slice(1)]);
    if (earned > 0) setAttack(current => current + earned);
  }

  stepRef.current = step;

  useEffect(() => {
    const id = window.setInterval(() => stepRef.current(), 520);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const human = players[0];
      if (event.key === 'ArrowLeft') updateHuman(move(human, -1));
      if (event.key === 'ArrowRight') updateHuman(move(human, 1));
      if (event.key === 'ArrowUp') updateHuman(rotate(human));
      if (event.key === 'ArrowDown') updateHuman(softDrop(human));
      if (event.key === ' ') updateHuman(hardDrop(human));
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [players]);

  const targetKo = players.find(player => player.id === target)?.ko ?? true;

  return (
    <main>
      <header>
        <strong>Tick {tick}</strong>
        <span>Leader {leader}</span>
        <span>Active {activePlayers}</span>
        <span>Pending {totalPending}</span>
        <span>Attack {attack}</span>
        {winner ? <b>Winner {winner}</b> : null}
        {TARGETS.map(id => (
          <button key={id} disabled={target === id} onClick={() => setTarget(id)}>{id}</button>
        ))}
        <button disabled={attack < 2 || targetKo} onClick={() => send(2)}>Send 2</button>
        <button disabled={attack < 4 || targetKo} onClick={() => send(4)}>Send 4</button>
        <button onClick={() => setPaused(value => !value)}>{paused ? 'Run' : 'Pause'}</button>
      </header>

      <section>
        {PLAYER_IDS.map(id => {
          const player = players.find(candidate => candidate.id === id)!;
          return <PlayerCard key={id} player={player} selected={target === id} />;
        })}
      </section>

      <ol>
        {sendLog.map((send, index) => (
          <li key={index}>{send.from} sent {send.lines} to {send.to}</li>
        ))}
      </ol>
    </main>
  );
}

function PlayerCard({ player, selected }: { player: PlayerState; selected: boolean }) {
  const board = boardWithActivePiece(player);
  return (
    <article>
      <header>
        <b>{player.name}</b>
        {selected ? <strong>TARGET</strong> : null}
        {player.ko ? <strong>KO</strong> : null}
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
        {board.flatMap((row, rowIndex) =>
          row.map((cell, colIndex) => (
            <span key={`${rowIndex}-${colIndex}`} data-cell={cell} />
          )),
        )}
      </div>
      <footer>
        <span>score {player.score}</span>
        <span>lines {player.lines}</span>
        <span>queue {player.pendingGarbage}</span>
        <span>sent {player.lastSent}</span>
        <span>recv {player.lastReceived}</span>
      </footer>
    </article>
  );
}

function boardWithActivePiece(player: PlayerState): Cell[][] {
  const board = player.board.map(row => [...row] as Cell[]);
  if (player.ko) return board;
  const shape = shapeFor(player.piece, player.rot);
  const color = (['I', 'O', 'T', 'S', 'Z', 'L', 'J'].indexOf(player.piece) + 1) as Cell;
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const y = player.y + r;
      const x = player.x + c;
      if (y >= 0 && y < ROWS && x >= 0 && x < COLS) board[y][x] = color;
    }
  }
  return board;
}
