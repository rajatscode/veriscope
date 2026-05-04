<script lang="ts">
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

  let players = $state(resetPlayers(DEFAULT_OPPONENTS));
  let opponentCount = $state<OpponentCount>(DEFAULT_OPPONENTS);
  let started = $state(false);
  let target = $state<PlayerId>('p2');
  let tick = $state(0);
  let paused = $state(false);
  let attack = $state(0);
  let sendLog = $state<GarbageSend[]>([]);

  let activePlayers = $derived(players.filter(player => !player.ko).length);
  let leader = $derived([...players].sort((a, b) => b.score - a.score)[0].id);
  let winner = $derived(started && activePlayers === 1 ? players.find(player => !player.ko)?.id : null);
  let totalPending = $derived(players.reduce((sum, player) => sum + player.pendingGarbage, 0));
  let targets = $derived(targetIdsFor(opponentCount));

  function commit(nextPlayers: PlayerState[], sends: GarbageSend[]) {
    players = nextPlayers;
    tick += 1;
    if (sends.length > 0) {
      sendLog = [...sends, ...sendLog].slice(0, 8);
    }
  }

  function step() {
    if (!started || paused || activePlayers <= 1) return;
    const result = advanceArena(players, target, { holdHumanGarbage: true });
    const earned = garbageFromClearedLines(result.players[0].lastCleared);
    commit(result.players, result.sends);
    if (earned > 0) attack += earned;
  }

  function start() {
    const count = clampOpponentCount(opponentCount);
    opponentCount = count;
    players = resetPlayers(count);
    target = 'p2';
    tick = 0;
    paused = false;
    attack = 0;
    sendLog = [];
    started = true;
  }

  function changeOpponentCount(value: number) {
    const count = clampOpponentCount(value);
    opponentCount = count;
    target = 'p2';
    if (!started) players = resetPlayers(count);
  }

  function send(lines: number) {
    if (!started || winner || players[0].ko || attack < lines) return;
    const recipient = players.find(player => player.id === target);
    if (!recipient || recipient.ko) return;
    const result = sendManualGarbage(players, 'p1', target, lines);
    if (result.sends.length === 0) return;
    attack -= lines;
    commit(result.players, result.sends);
  }

  function updateHuman(next: PlayerState) {
    if (!started || winner || players[0].ko) return;
    const newlyCleared = Math.max(0, next.lines - players[0].lines);
    const earned = garbageFromClearedLines(newlyCleared);
    players = [next, ...players.slice(1)];
    if (earned > 0) attack += earned;
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!started) return;
    const human = players[0];
    if (event.key === 'ArrowLeft') updateHuman(move(human, -1));
    if (event.key === 'ArrowRight') updateHuman(move(human, 1));
    if (event.key === 'ArrowUp') updateHuman(rotate(human));
    if (event.key === 'ArrowDown') updateHuman(softDrop(human));
    if (event.key === ' ') updateHuman(hardDrop(human));
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

  const interval = setInterval(step, 520);
</script>

<svelte:window onkeydown={onKeyDown} />

<main>
  {#if !started}
    <section>
      <label>
        AI opponents
        <input type="range" min={MIN_OPPONENTS} max={MAX_OPPONENTS} value={opponentCount} oninput={(event) => changeOpponentCount(Number(event.currentTarget.value))} />
        <input type="number" min={MIN_OPPONENTS} max={MAX_OPPONENTS} value={opponentCount} oninput={(event) => changeOpponentCount(Number(event.currentTarget.value))} />
      </label>
      <button onclick={start}>Start</button>
    </section>
  {/if}

  <header>
    <strong>Tick {tick}</strong>
    <span>Opponents {opponentCount}</span>
    <span>Leader {leader}</span>
    <span>Active {activePlayers}</span>
    <span>Pending {totalPending}</span>
    <span>Attack {attack}</span>
    {#if winner}<b>Winner {winner}</b>{/if}
    {#each targets as id}
      <button disabled={target === id} onclick={() => target = id}>{id}</button>
    {/each}
    <button disabled={!started || !!winner || attack < 2 || !!players.find(player => player.id === target)?.ko} onclick={() => send(2)}>Send 2</button>
    <button disabled={!started || !!winner || attack < 4 || !!players.find(player => player.id === target)?.ko} onclick={() => send(4)}>Send 4</button>
    <button onclick={() => paused = !paused}>{paused ? 'Run' : 'Pause'}</button>
    <button onclick={start}>Restart</button>
  </header>

  <section>
    {#each players as player}
      <article>
        <header>
          <b>{player.name}</b>
          {#if target === player.id}<strong>TARGET</strong>{/if}
          {#if player.ko}<strong>KO</strong>{/if}
        </header>
        <div style={`display:grid; grid-template-columns:repeat(${COLS}, 1fr);`}>
          {#each boardWithActivePiece(player).flat() as cell}
            <span data-cell={cell}></span>
          {/each}
        </div>
        <footer>
          <span>score {player.score}</span>
          <span>lines {player.lines}</span>
          <span>queue {player.pendingGarbage}</span>
          <span>sent {player.lastSent}</span>
          <span>recv {player.lastReceived}</span>
        </footer>
      </article>
    {/each}
  </section>

  <ol>
    {#each sendLog as send}
      <li>{send.from} sent {send.lines} to {send.to}</li>
    {/each}
  </ol>
</main>
