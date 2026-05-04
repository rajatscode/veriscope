/** @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, For, onCleanup } from 'solid-js';
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

export function PlainSolidVsTetris() {
  const [players, setPlayers] = createSignal(resetPlayers(DEFAULT_OPPONENTS));
  const [opponentCount, setOpponentCount] = createSignal<OpponentCount>(DEFAULT_OPPONENTS);
  const [started, setStarted] = createSignal(false);
  const [target, setTarget] = createSignal<PlayerId>('p2');
  const [tick, setTick] = createSignal(0);
  const [paused, setPaused] = createSignal(false);
  const [attack, setAttack] = createSignal(0);
  const [sendLog, setSendLog] = createSignal<GarbageSend[]>([]);

  const activePlayers = createMemo(() => players().filter(player => !player.ko).length);
  const leader = createMemo(() => [...players()].sort((a, b) => b.score - a.score)[0].id);
  const winner = createMemo(() => started() && activePlayers() === 1 ? players().find(player => !player.ko)?.id : null);
  const totalPending = createMemo(() => players().reduce((sum, player) => sum + player.pendingGarbage, 0));
  const targets = createMemo(() => targetIdsFor(opponentCount()));

  function commit(nextPlayers: PlayerState[], sends: GarbageSend[]) {
    setPlayers(nextPlayers);
    setTick(value => value + 1);
    if (sends.length > 0) {
      setSendLog(previous => [...sends, ...previous].slice(0, 8));
    }
  }

  function step() {
    if (!started() || paused() || activePlayers() <= 1) return;
    const result = advanceArena(players(), target(), { holdHumanGarbage: true });
    const earned = garbageFromClearedLines(result.players[0].lastCleared);
    commit(result.players, result.sends);
    if (earned > 0) setAttack(value => value + earned);
  }

  function start() {
    const count = clampOpponentCount(opponentCount());
    setOpponentCount(count);
    setPlayers(resetPlayers(count));
    setTarget('p2');
    setTick(0);
    setPaused(false);
    setAttack(0);
    setSendLog([]);
    setStarted(true);
  }

  function changeOpponentCount(value: number) {
    const count = clampOpponentCount(value);
    setOpponentCount(count);
    setTarget('p2');
    if (!started()) setPlayers(resetPlayers(count));
  }

  function send(lines: number) {
    if (!started() || winner() || players()[0].ko || attack() < lines) return;
    const recipient = players().find(player => player.id === target());
    if (!recipient || recipient.ko) return;
    const result = sendManualGarbage(players(), 'p1', target(), lines);
    if (result.sends.length === 0) return;
    setAttack(value => value - lines);
    commit(result.players, result.sends);
  }

  function updateHuman(next: PlayerState) {
    if (!started() || winner() || players()[0].ko) return;
    const newlyCleared = Math.max(0, next.lines - players()[0].lines);
    const earned = garbageFromClearedLines(newlyCleared);
    setPlayers(current => [next, ...current.slice(1)]);
    if (earned > 0) setAttack(value => value + earned);
  }

  const interval = window.setInterval(step, 520);
  onCleanup(() => window.clearInterval(interval));

  createEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!started()) return;
      const human = players()[0];
      if (event.key === 'ArrowLeft') updateHuman(move(human, -1));
      if (event.key === 'ArrowRight') updateHuman(move(human, 1));
      if (event.key === 'ArrowUp') updateHuman(rotate(human));
      if (event.key === 'ArrowDown') updateHuman(softDrop(human));
      if (event.key === ' ') updateHuman(hardDrop(human));
    }
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  return (
    <main>
      {!started() ? (
        <section>
          <label>
            AI opponents
            <input type="range" min={MIN_OPPONENTS} max={MAX_OPPONENTS} value={opponentCount()} onInput={event => changeOpponentCount(Number(event.currentTarget.value))} />
            <input type="number" min={MIN_OPPONENTS} max={MAX_OPPONENTS} value={opponentCount()} onInput={event => changeOpponentCount(Number(event.currentTarget.value))} />
          </label>
          <button onClick={start}>Start</button>
        </section>
      ) : null}
      <header>
        <strong>Tick {tick()}</strong>
        <span>Opponents {opponentCount()}</span>
        <span>Leader {leader()}</span>
        <span>Active {activePlayers()}</span>
        <span>Pending {totalPending()}</span>
        <span>Attack {attack()}</span>
        {winner() ? <b>Winner {winner()}</b> : null}
        <For each={targets()}>
          {id => <button disabled={target() === id} onClick={() => setTarget(id)}>{id}</button>}
        </For>
        <button disabled={!started() || !!winner() || attack() < 2 || !!players().find(player => player.id === target())?.ko} onClick={() => send(2)}>Send 2</button>
        <button disabled={!started() || !!winner() || attack() < 4 || !!players().find(player => player.id === target())?.ko} onClick={() => send(4)}>Send 4</button>
        <button onClick={() => setPaused(value => !value)}>{paused() ? 'Run' : 'Pause'}</button>
        <button onClick={start}>Restart</button>
      </header>

      <section>
        <For each={players()}>
          {player => <PlayerCard player={player} selected={target() === player.id} />}
        </For>
      </section>

      <ol>
        <For each={sendLog()}>
          {(send, index) => <li>{send.from} sent {send.lines} to {send.to} #{index()}</li>}
        </For>
      </ol>
    </main>
  );
}

function PlayerCard(props: { player: PlayerState; selected: boolean }) {
  const board = createMemo(() => boardWithActivePiece(props.player));
  return (
    <article>
      <header>
        <b>{props.player.name}</b>
        {props.selected ? <strong>TARGET</strong> : null}
        {props.player.ko ? <strong>KO</strong> : null}
      </header>
      <div style={{ display: 'grid', 'grid-template-columns': `repeat(${COLS}, 1fr)` }}>
        <For each={board().flatMap((row, rowIndex) => row.map((cell, colIndex) => ({ cell, rowIndex, colIndex })))}>
          {item => <span data-cell={item.cell} />}
        </For>
      </div>
      <footer>
        <span>score {props.player.score}</span>
        <span>lines {props.player.lines}</span>
        <span>queue {props.player.pendingGarbage}</span>
        <span>sent {props.player.lastSent}</span>
        <span>recv {props.player.lastReceived}</span>
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
