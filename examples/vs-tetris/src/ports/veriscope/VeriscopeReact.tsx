import { useEffect, useMemo, useRef, useState } from 'react';
import { assertAfter, assertAlways, coverage, graph } from '@veriscope/graph';
import { useDerived, useSignal } from '@veriscope/react';
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

export function VeriscopeReactVsTetris() {
  const initialized = useRef(false);
  if (!initialized.current) {
    graph.reset();
    graph.enableCoverage();
    initialized.current = true;
  }

  const initial = useMemo(() => resetPlayers(), []);
  const p1 = useSignal(initial[0], 'p1.state');
  const p2 = useSignal(initial[1], 'p2.state');
  const p3 = useSignal(initial[2], 'p3.state');
  const p4 = useSignal(initial[3], 'p4.state');
  const target = useSignal<PlayerId>('p2', 'arena.humanTarget', { states: TARGETS });
  const tick = useSignal(0, 'arena.tick');
  const paused = useSignal(false, 'arena.paused');
  const garbagePulse = useSignal(false, 'arena.garbagePulse');
  const attack = useSignal(0, 'p1.attackBank');
  const players = [p1, p2, p3, p4] as const;

  const totalPending = useDerived(
    () => players.reduce((sum, player) => sum + player.val.pendingGarbage, 0),
    [...players],
    'arena.totalPendingGarbage',
  );
  const leader = useDerived(
    () => [...players].sort((a, b) => b.val.score - a.val.score)[0].val.id,
    [...players],
    'arena.leader',
  );
  const activePlayers = useDerived(
    () => players.filter(player => !player.val.ko).length,
    [...players],
    'arena.activePlayers',
  );

  const [sendLog, setSendLog] = useState<GarbageSend[]>([]);
  const stepRef = useRef<() => void>(() => {});

  function currentPlayers(): PlayerState[] {
    return players.map(player => player.val);
  }

  function commit(nextPlayers: PlayerState[], sends: GarbageSend[]) {
    p1.set(nextPlayers[0]);
    p2.set(nextPlayers[1]);
    p3.set(nextPlayers[2]);
    p4.set(nextPlayers[3]);
    tick.set(tick.val + 1);

    if (sends.length > 0) {
      if (garbagePulse.val) garbagePulse.set(false);
      garbagePulse.set(true);
      setSendLog(previous => [...sends, ...previous].slice(0, 8));
    } else if (garbagePulse.val) {
      garbagePulse.set(false);
    }
  }

  function stepArena() {
    if (paused.val || activePlayers.val <= 1) return;
    const result = advanceArena(currentPlayers(), target.val, { holdHumanGarbage: true });
    const earned = garbageFromClearedLines(result.players[0].lastCleared);
    commit(result.players, result.sends);
    if (earned > 0) attack.set(attack.val + earned);
  }

  function sendGarbage(lines: number) {
    if (attack.val < lines) return;
    const recipient = players.find(player => player.val.id === target.val);
    if (!recipient || recipient.val.ko) return;
    const result = sendManualGarbage(currentPlayers(), 'p1', target.val, lines);
    if (result.sends.length === 0) return;
    attack.set(attack.val - lines);
    commit(result.players, result.sends);
  }

  function updateHuman(nextHuman: PlayerState) {
    const newlyCleared = Math.max(0, nextHuman.lines - p1.val.lines);
    const earned = garbageFromClearedLines(newlyCleared);
    p1.set(nextHuman);
    if (earned > 0) attack.set(attack.val + earned);
  }

  stepRef.current = stepArena;

  useEffect(() => {
    graph.startRecording();
    const id = window.setInterval(() => stepRef.current(), 520);
    return () => {
      window.clearInterval(id);
      graph.stopRecording();
      coverage.reset();
    };
  }, []);

  useEffect(() => {
    const assertionIds = [
      assertAlways(
        () => players.every(player => player.val.score >= 0 && player.val.pendingGarbage >= 0),
        'scores-and-garbage-nonnegative',
        graph,
        [...players],
      ),
      assertAlways(() => target.val !== 'p1', 'human-never-targets-self', graph, [target]),
      assertAfter(
        garbagePulse,
        'posedge',
        'immediately',
        () => totalPending.val > 0 || players.some(player => player.val.lastReceived > 0),
        { name: 'garbage-send-has-recipient' },
        graph,
      ),
    ];
    return () => assertionIds.forEach(id => graph.disposeNode(id));
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (p1.val.ko) return;
      if (event.key === 'ArrowLeft') updateHuman(move(p1.val, -1));
      if (event.key === 'ArrowRight') updateHuman(move(p1.val, 1));
      if (event.key === 'ArrowUp') updateHuman(rotate(p1.val));
      if (event.key === 'ArrowDown') updateHuman(softDrop(p1.val));
      if (event.key === ' ') {
        event.preventDefault();
        updateHuman(hardDrop(p1.val));
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const targetKo = players.find(player => player.val.id === target.val)?.val.ko ?? true;

  return (
    <section>
      <header>
        <strong>Tick {tick.val}</strong>
        <span>Leader {leader.val}</span>
        <span>Active {activePlayers.val}</span>
        <span>Pending {totalPending.val}</span>
        {TARGETS.map(id => (
          <button key={id} onClick={() => target.set(id)} disabled={target.val === id}>{id}</button>
        ))}
        <span>Available garbage {attack.val}</span>
        <button disabled={attack.val < 2 || targetKo} onClick={() => sendGarbage(2)}>Send 2</button>
        <button disabled={attack.val < 4 || targetKo} onClick={() => sendGarbage(4)}>Send 4</button>
        <button onClick={() => paused.set(!paused.val)}>{paused.val ? 'Run' : 'Pause'}</button>
      </header>

      <div>
        {PLAYER_IDS.map(id => {
          const player = players.find(candidate => candidate.val.id === id)!.val;
          return <PlayerCard key={id} player={player} selected={target.val === id} />;
        })}
      </div>

      <ol>
        {sendLog.map((send, index) => (
          <li key={index}>{send.from} sent {send.lines} to {send.to}</li>
        ))}
      </ol>
    </section>
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
