/** @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, For, onCleanup } from 'solid-js';
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

export function PlainSolidVsTetris() {
  const [players, setPlayers] = createSignal(resetPlayers());
  const [target, setTarget] = createSignal<PlayerId>('p2');
  const [tick, setTick] = createSignal(0);
  const [paused, setPaused] = createSignal(false);
  const [attack, setAttack] = createSignal(0);
  const [sendLog, setSendLog] = createSignal<GarbageSend[]>([]);

  const activePlayers = createMemo(() => players().filter(player => !player.ko).length);
  const leader = createMemo(() => [...players()].sort((a, b) => b.score - a.score)[0].id);
  const winner = createMemo(() => activePlayers() === 1 ? players().find(player => !player.ko)?.id : null);
  const totalPending = createMemo(() => players().reduce((sum, player) => sum + player.pendingGarbage, 0));

  function commit(nextPlayers: PlayerState[], sends: GarbageSend[]) {
    setPlayers(nextPlayers);
    setTick(value => value + 1);
    if (sends.length > 0) {
      setSendLog(previous => [...sends, ...previous].slice(0, 8));
    }
  }

  function step() {
    if (paused() || activePlayers() <= 1) return;
    const result = advanceArena(players(), target(), { holdHumanGarbage: true });
    const earned = garbageFromClearedLines(result.players[0].lastCleared);
    commit(result.players, result.sends);
    if (earned > 0) setAttack(value => value + earned);
  }

  function send(lines: number) {
    if (attack() < lines) return;
    const recipient = players().find(player => player.id === target());
    if (!recipient || recipient.ko) return;
    const result = sendManualGarbage(players(), 'p1', target(), lines);
    if (result.sends.length === 0) return;
    setAttack(value => value - lines);
    commit(result.players, result.sends);
  }

  function updateHuman(next: PlayerState) {
    const newlyCleared = Math.max(0, next.lines - players()[0].lines);
    const earned = garbageFromClearedLines(newlyCleared);
    setPlayers(current => [next, ...current.slice(1)]);
    if (earned > 0) setAttack(value => value + earned);
  }

  const interval = window.setInterval(step, 520);
  onCleanup(() => window.clearInterval(interval));

  createEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
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
      <header>
        <strong>Tick {tick()}</strong>
        <span>Leader {leader()}</span>
        <span>Active {activePlayers()}</span>
        <span>Pending {totalPending()}</span>
        <span>Attack {attack()}</span>
        {winner() ? <b>Winner {winner()}</b> : null}
        <For each={TARGETS}>
          {id => <button disabled={target() === id} onClick={() => setTarget(id)}>{id}</button>}
        </For>
        <button disabled={attack() < 2 || !!players().find(player => player.id === target())?.ko} onClick={() => send(2)}>Send 2</button>
        <button disabled={attack() < 4 || !!players().find(player => player.id === target())?.ko} onClick={() => send(4)}>Send 4</button>
        <button onClick={() => setPaused(value => !value)}>{paused() ? 'Run' : 'Pause'}</button>
      </header>

      <section>
        <For each={PLAYER_IDS}>
          {id => <PlayerCard player={players().find(candidate => candidate.id === id)!} selected={target() === id} />}
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
