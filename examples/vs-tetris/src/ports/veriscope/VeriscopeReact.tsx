import { useEffect, useMemo, useRef, useState } from 'react';
import { assertAfter, assertAlways, coverage, graph } from '@veriscope/graph';
import { useDerived, useSignal } from '@veriscope/react';
import {
  COLS,
  DEFAULT_OPPONENTS,
  MAX_OPPONENTS,
  MIN_OPPONENTS,
  ROWS,
  advanceArena,
  clampOpponentCount,
  garbageFromClearedLines,
  hardDrop,
  move,
  resetPlayers,
  rotate,
  sendManualGarbage,
  shapeFor,
  softDrop,
  targetIdsFor,
  type Cell,
  type GarbageSend,
  type OpponentCount,
  type PlayerId,
  type PlayerState,
} from '../../tetris';

const TARGET_STATES = targetIdsFor(MAX_OPPONENTS);

export function VeriscopeReactVsTetris() {
  const initialized = useRef(false);
  if (!initialized.current) {
    graph.reset();
    graph.enableCoverage();
    initialized.current = true;
  }

  const initial = useMemo(() => resetPlayers(DEFAULT_OPPONENTS), []);
  const players = useSignal(initial, 'arena.players');
  const opponentCount = useSignal<OpponentCount>(DEFAULT_OPPONENTS, 'arena.opponentCount');
  const started = useSignal(false, 'arena.started');
  const target = useSignal<PlayerId>('p2', 'arena.humanTarget', { states: TARGET_STATES });
  const tick = useSignal(0, 'arena.tick');
  const paused = useSignal(false, 'arena.paused');
  const garbagePulse = useSignal(false, 'arena.garbagePulse');
  const attack = useSignal(0, 'p1.attackBank');

  const totalPending = useDerived(
    () => players.val.reduce((sum, player) => sum + player.pendingGarbage, 0),
    [players],
    'arena.totalPendingGarbage',
  );
  const activePlayers = useDerived(
    () => players.val.filter(player => !player.ko).length,
    [players],
    'arena.activePlayers',
  );
  const leader = useDerived(
    () => [...players.val].sort((a, b) => b.score - a.score)[0]?.id ?? 'p1',
    [players],
    'arena.leader',
  );
  const winner = useDerived(
    () => {
      if (!started.val) return null;
      const active = players.val.filter(player => !player.ko);
      return active.length === 1 ? active[0].id : null;
    },
    [started, players],
    'arena.winner',
  );

  const [sendLog, setSendLog] = useState<GarbageSend[]>([]);
  const stepRef = useRef<() => void>(() => {});

  function commit(nextPlayers: PlayerState[], sends: GarbageSend[]) {
    players.set(nextPlayers);
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
    if (!started.val || paused.val || activePlayers.val <= 1) return;
    const result = advanceArena(players.val, target.val, { holdHumanGarbage: true });
    const earned = garbageFromClearedLines(result.players[0].lastCleared);
    commit(result.players, result.sends);
    if (earned > 0) attack.set(attack.val + earned);
  }

  function start() {
    const count = clampOpponentCount(opponentCount.val);
    opponentCount.set(count);
    players.set(resetPlayers(count));
    target.set('p2');
    tick.set(0);
    paused.set(false);
    attack.set(0);
    garbagePulse.set(false);
    setSendLog([]);
    started.set(true);
  }

  function changeOpponentCount(value: number) {
    const count = clampOpponentCount(value);
    opponentCount.set(count);
    target.set('p2');
    if (!started.val) players.set(resetPlayers(count));
  }

  function sendGarbage(lines: number) {
    if (!started.val || winner.val || players.val[0]?.ko || attack.val < lines) return;
    const recipient = players.val.find(player => player.id === target.val);
    if (!recipient || recipient.ko) return;
    const result = sendManualGarbage(players.val, 'p1', target.val, lines);
    if (result.sends.length === 0) return;
    attack.set(attack.val - lines);
    commit(result.players, result.sends);
  }

  function updateHuman(nextHuman: PlayerState) {
    if (!started.val || winner.val || players.val[0]?.ko) return;
    const earned = garbageFromClearedLines(Math.max(0, nextHuman.lines - players.val[0].lines));
    players.set([nextHuman, ...players.val.slice(1)]);
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
        () => players.val.every(player => player.score >= 0 && player.pendingGarbage >= 0),
        'scores-and-garbage-nonnegative',
        graph,
        [players],
      ),
      assertAlways(() => target.val !== 'p1', 'human-never-targets-self', graph, [target]),
      assertAfter(
        garbagePulse,
        'posedge',
        'immediately',
        () => totalPending.val > 0 || players.val.some(player => player.lastReceived > 0),
        { name: 'garbage-send-has-recipient' },
        graph,
      ),
    ];
    return () => assertionIds.forEach(id => graph.disposeNode(id));
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!started.val) return;
      const human = players.val[0];
      if (!human || human.ko) return;
      if (event.key === 'ArrowLeft') updateHuman(move(human, -1));
      if (event.key === 'ArrowRight') updateHuman(move(human, 1));
      if (event.key === 'ArrowUp') updateHuman(rotate(human));
      if (event.key === 'ArrowDown') updateHuman(softDrop(human));
      if (event.key === ' ') {
        event.preventDefault();
        updateHuman(hardDrop(human));
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const targetKo = players.val.find(player => player.id === target.val)?.ko ?? true;
  const targets = targetIdsFor(opponentCount.val);

  return (
    <section>
      {!started.val ? (
        <section>
          <label>
            AI opponents
            <input type="range" min={MIN_OPPONENTS} max={MAX_OPPONENTS} value={opponentCount.val} onChange={event => changeOpponentCount(Number(event.currentTarget.value))} />
            <input type="number" min={MIN_OPPONENTS} max={MAX_OPPONENTS} value={opponentCount.val} onChange={event => changeOpponentCount(Number(event.currentTarget.value))} />
          </label>
          <button onClick={start}>Start</button>
        </section>
      ) : null}

      <header>
        <strong>Tick {tick.val}</strong>
        <span>Opponents {opponentCount.val}</span>
        <span>Leader {leader.val}</span>
        <span>Active {activePlayers.val}</span>
        <span>Pending {totalPending.val}</span>
        <span>Available garbage {attack.val}</span>
        {winner.val ? <b>Winner {winner.val}</b> : null}
        {targets.map(id => (
          <button key={id} onClick={() => target.set(id)} disabled={target.val === id}>{id}</button>
        ))}
        <button disabled={!started.val || !!winner.val || attack.val < 2 || targetKo} onClick={() => sendGarbage(2)}>Send 2</button>
        <button disabled={!started.val || !!winner.val || attack.val < 4 || targetKo} onClick={() => sendGarbage(4)}>Send 4</button>
        <button onClick={() => paused.set(!paused.val)}>{paused.val ? 'Run' : 'Pause'}</button>
        <button onClick={start}>Restart</button>
      </header>

      <div>
        {players.val.map(player => (
          <PlayerCard key={player.id} player={player} selected={target.val === player.id} />
        ))}
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
