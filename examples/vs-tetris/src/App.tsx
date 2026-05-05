import { useEffect, useMemo, useRef, useState } from 'react';
import { coverage, graph } from '@veriscope/graph';
import { useDerived, useSignal, useTrackedEffect } from '@veriscope/react';
import { mountDevtools } from '@veriscope/devtools';
import { runAutotest } from '@veriscope/test';
import { mutate as runMutationTest } from '@veriscope/mutate';
import { leftSources, rightSources } from './reviewSources';
import {
  COLS,
  DEFAULT_OPPONENTS,
  MAX_OPPONENTS,
  MIN_OPPONENTS,
  PIECE_COLORS,
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
} from './tetris';
import { createVsTetrisGraph, registerTetrisAssertions, registerTetrisTelemetry } from './veriscopeTetris';

export function App() {
  const initialized = useRef(false);
  if (!initialized.current) {
    graph.reset();
    graph.enableCoverage();
    initialized.current = true;
  }

  const initialPlayers = useMemo(() => resetPlayers(DEFAULT_OPPONENTS), []);
  const arenaPlayers = useSignal(initialPlayers, 'arena.players');
  const humanTarget = useSignal<PlayerId>('p2', 'arena.humanTarget');
  const opponentCount = useSignal<OpponentCount>(DEFAULT_OPPONENTS, 'arena.opponentCount');
  const started = useSignal(false, 'arena.started');
  const arenaTick = useSignal(0, 'arena.tick');
  const paused = useSignal(false, 'arena.paused');
  const garbagePulse = useSignal(false, 'arena.garbagePulse');
  const attackBank = useSignal(0, 'p1.attackBank');

  const totalPending = useDerived(
    () => arenaPlayers.val.reduce((sum, player) => sum + player.pendingGarbage, 0),
    [arenaPlayers],
    'arena.totalPendingGarbage',
  );
  const activePlayers = useDerived(
    () => arenaPlayers.val.filter(player => !player.ko).length,
    [arenaPlayers],
    'arena.activePlayers',
  );
  const leader = useDerived(
    () => [...arenaPlayers.val].sort((a, b) => b.score - a.score)[0]?.id ?? 'p1',
    [arenaPlayers],
    'arena.leader',
  );
  const winner = useDerived(
    () => {
      if (!started.val) return null;
      const active = arenaPlayers.val.filter(player => !player.ko);
      return active.length === 1 ? active[0].id : null;
    },
    [started, arenaPlayers],
    'arena.winner',
  );
  const targetAlive = useDerived(
    () => {
      const target = arenaPlayers.val.find(player => player.id === humanTarget.val);
      return Boolean(target && !target.ko);
    },
    [arenaPlayers, humanTarget],
    'arena.targetAlive',
  );
  const humanAlive = useDerived(
    () => Boolean(arenaPlayers.val[0] && !arenaPlayers.val[0].ko),
    [arenaPlayers],
    'p1.alive',
  );
  const canSend2Signal = useDerived(
    () => started.val && !paused.val && !winner.val && humanAlive.val && targetAlive.val && attackBank.val >= 2,
    [started, paused, winner, humanAlive, targetAlive, attackBank],
    'p1.canSend2',
  );
  const canSend4Signal = useDerived(
    () => started.val && !paused.val && !winner.val && humanAlive.val && targetAlive.val && attackBank.val >= 4,
    [started, paused, winner, humanAlive, targetAlive, attackBank],
    'p1.canSend4',
  );
  const sendHasRecipient = useDerived(
    () => totalPending.val > 0 || arenaPlayers.val.some(player => player.lastReceived > 0),
    [arenaPlayers, totalPending],
    'arena.garbageSendHasRecipient',
  );
  useTrackedEffect(
    () => {
      document.title = !started.val
        ? 'VS Tetris setup'
        : winner.val
          ? `Winner ${winner.val.toUpperCase()} · VS Tetris`
          : `Tick ${arenaTick.val} · VS Tetris`;
    },
    [arenaTick, started, winner],
    'document-title-effect',
  );

  const [sendLog, setSendLog] = useState<GarbageSend[]>([]);
  const stepRef = useRef<() => void>(() => {});

  function currentPlayers(): PlayerState[] {
    return arenaPlayers.val;
  }

  function commit(nextPlayers: PlayerState[], sends: GarbageSend[], options?: { advanceTick?: boolean }) {
    arenaPlayers.set(nextPlayers);
    if (options?.advanceTick !== false) {
      arenaTick.set(arenaTick.val + 1);
    }

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
    const result = advanceArena(currentPlayers(), humanTarget.val, { holdHumanGarbage: true });
    const earned = garbageFromClearedLines(result.players[0].lastCleared);
    commit(result.players, result.sends);
    if (earned > 0) {
      attackBank.set(attackBank.val + earned);
    }
  }

  function startArena() {
    const count = clampOpponentCount(opponentCount.val);
    opponentCount.set(count);
    const next = resetPlayers(count);
    commit(next, [], { advanceTick: false });
    arenaTick.set(0);
    attackBank.set(0);
    garbagePulse.set(false);
    paused.set(false);
    humanTarget.set('p2');
    started.set(true);
    setSendLog([]);
  }

  function returnToSetup() {
    started.set(false);
    arenaPlayers.set(resetPlayers(opponentCount.val));
    paused.set(false);
    attackBank.set(0);
    garbagePulse.set(false);
    arenaTick.set(0);
    humanTarget.set('p2');
    setSendLog([]);
  }

  function changeOpponentCount(count: OpponentCount) {
    const nextCount = clampOpponentCount(count);
    opponentCount.set(nextCount);
    humanTarget.set('p2');
    if (!started.val) {
      arenaPlayers.set(resetPlayers(nextCount));
    }
  }

  function sendGarbage(lines: number) {
    const human = arenaPlayers.val[0];
    if (!started.val || winner.val || human?.ko) return;
    if (attackBank.val < lines) return;
    const target = arenaPlayers.val.find(player => player.id === humanTarget.val);
    if (!target || target.ko) return;

    const result = sendManualGarbage(currentPlayers(), 'p1', humanTarget.val, lines);
    if (result.sends.length === 0) return;
    attackBank.set(attackBank.val - lines);
    commit(result.players, result.sends);
  }

  function updateHuman(nextHuman: PlayerState) {
    if (!started.val) return;
    const current = arenaPlayers.val;
    if (winner.val || current[0]?.ko) return;
    const newlyCleared = Math.max(0, nextHuman.lines - current[0].lines);
    const earned = garbageFromClearedLines(newlyCleared);
    arenaPlayers.set([nextHuman, ...current.slice(1)]);
    if (earned > 0) {
      attackBank.set(attackBank.val + earned);
    }
  }

  stepRef.current = stepArena;

  useEffect(() => {
    graph.startRecording();
    return () => {
      graph.stopRecording();
      graph.disableCoverage();
    };
  }, []);

  useEffect(() => {
    const telemetry = registerTetrisTelemetry(graph, arenaPlayers.nodeId, () => arenaPlayers.val);
    return () => telemetry.dispose();
  }, [opponentCount.val]);

  useEffect(() => {
    const targetDomain = targetIdsFor(opponentCount.val);
    const assertions = registerTetrisAssertions(graph, {
      playersNodeId: arenaPlayers.nodeId,
      getPlayers: () => arenaPlayers.val,
      humanTargetNodeId: humanTarget.nodeId,
      getHumanTarget: () => humanTarget.val,
      targetDomain,
      attackBankNodeId: attackBank.nodeId,
      getAttackBank: () => attackBank.val,
      canSend2NodeId: canSend2Signal.nodeId,
      getCanSend2: () => canSend2Signal.val,
      canSend4NodeId: canSend4Signal.nodeId,
      getCanSend4: () => canSend4Signal.val,
      garbagePulseNodeId: garbagePulse.nodeId,
      getGarbagePulse: () => garbagePulse.val,
      sendHasRecipientNodeId: sendHasRecipient.nodeId,
      getSendHasRecipient: () => sendHasRecipient.val,
    });

    return () => assertions.dispose();
  }, [opponentCount.val]);

  useEffect(() => {
    const id = window.setInterval(() => stepRef.current(), 520);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (!started.val) return;
      const human = arenaPlayers.val[0];
      if (!human || human.ko) return;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        updateHuman(move(human, -1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        updateHuman(move(human, 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        updateHuman(rotate(human));
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        updateHuman(softDrop(human));
      } else if (event.key === ' ') {
        event.preventDefault();
        updateHuman(hardDrop(human));
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const activeSlots = arenaPlayers.val;
  const availableTargets = targetIdsFor(opponentCount.val);
  const selectedTarget = activeSlots.find(player => player.id === humanTarget.val);
  const selectedTargetKo = selectedTarget?.ko ?? true;
  const canPlay = started.val && !winner.val && !activeSlots[0]?.ko;
  const canSend2 = canPlay && canSend2Signal.val && !selectedTargetKo;
  const canSend4 = canPlay && canSend4Signal.val && !selectedTargetKo;

  return (
    <main className="app-shell">
      {!started.val ? (
        <SetupPanel
          opponentCount={opponentCount.val}
          onOpponentCountChange={changeOpponentCount}
          onStart={startArena}
        />
      ) : (
        <>
          <section className="arena-toolbar" aria-label="Arena controls">
            <div className="brand-lockup">
              <span className="brand-title">VS Tetris</span>
              <span className="brand-subtitle">
                Tick {arenaTick.val} · Opponents {opponentCount.val} · Leader {leader.val.toUpperCase()} · Active {activePlayers.val}
                {winner.val ? ` · Winner ${winner.val.toUpperCase()}` : ''}
              </span>
            </div>
            <div className="target-control" aria-label="Garbage target">
              <label htmlFor="garbage-target">Target</label>
              <select id="garbage-target" value={humanTarget.val} onChange={event => humanTarget.set(event.currentTarget.value)}>
                {availableTargets.map(target => (
                  <option key={target} value={target}>{target.toUpperCase()}</option>
                ))}
              </select>
            </div>
            <div className="send-control">
              <GarbageBank amount={attackBank.val} />
              <div className="command-row">
                <button className={canSend2 ? 'attack-ready' : ''} disabled={!canSend2} onClick={() => sendGarbage(2)}>Send 2 to {humanTarget.val.toUpperCase()}</button>
                <button className={canSend4 ? 'attack-ready' : ''} disabled={!canSend4} onClick={() => sendGarbage(4)}>Send 4 to {humanTarget.val.toUpperCase()}</button>
                <button onClick={() => stepRef.current()}>Step</button>
                <button onClick={() => paused.set(!paused.val)}>{paused.val ? 'Run' : 'Pause'}</button>
                <button onClick={startArena}>Restart</button>
                <button onClick={returnToSetup}>Setup</button>
              </div>
            </div>
          </section>

          <section className="arena-grid" aria-label="Players">
            {activeSlots.map(player => (
              <PlayerBoard key={player.id} player={player} selectedTarget={humanTarget.val} />
            ))}
          </section>

          <section className="telemetry-grid" aria-label="Telemetry">
            <div className="telemetry-panel">
              <div className="panel-title">Signals</div>
              <div className="signal-grid">
                <Metric label="Pending" value={totalPending.val} />
                <Metric label="Pulse" value={garbagePulse.val ? 'high' : 'low'} />
                <Metric label="Target" value={humanTarget.val.toUpperCase()} />
                <Metric label="Attack" value={attackBank.val} />
                <Metric label="Paused" value={paused.val ? 'yes' : 'no'} />
              </div>
            </div>
            <div className="telemetry-panel">
              <div className="panel-title">Garbage</div>
              <div className="send-log">
                {sendLog.length === 0 ? <span className="empty-row">No sends yet</span> : sendLog.map((send, index) => (
                  <span key={`${send.from}-${send.to}-${index}`} className="send-row">
                    {send.from.toUpperCase()} <b>{send.lines}</b> {send.to.toUpperCase()}
                  </span>
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      <SourceReview />

      <EmbeddedDevtools opponentCount={opponentCount.val} />
    </main>
  );
}

function SetupPanel({
  opponentCount,
  onOpponentCountChange,
  onStart,
}: {
  opponentCount: OpponentCount;
  onOpponentCountChange: (count: OpponentCount) => void;
  onStart: () => void;
}) {
  return (
    <section className="setup-panel" aria-label="VS Tetris setup">
      <div className="setup-copy">
        <span className="brand-title">VS Tetris</span>
        <span className="brand-subtitle">Choose the arena size before starting. The simulation stays stopped until Start.</span>
      </div>
      <div className="setup-controls">
        <div className="opponent-control" aria-label="AI opponents">
          <label htmlFor="opponent-count">AI opponents</label>
          <input
            id="opponent-count"
            type="range"
            min={MIN_OPPONENTS}
            max={MAX_OPPONENTS}
            value={opponentCount}
            onChange={event => onOpponentCountChange(Number(event.currentTarget.value))}
          />
          <input
            type="number"
            min={MIN_OPPONENTS}
            max={MAX_OPPONENTS}
            value={opponentCount}
            onChange={event => onOpponentCountChange(Number(event.currentTarget.value))}
            aria-label="AI opponent count"
          />
        </div>
        <button className="start-button" onClick={onStart}>Start</button>
      </div>
    </section>
  );
}

function PlayerBoard({
  player,
  selectedTarget,
}: {
  player: PlayerState;
  selectedTarget: PlayerId;
}) {
  const cells = boardWithActivePiece(player);
  return (
    <article className={`player-card ${player.kind === 'human' ? 'human' : 'ai'} ${player.ko ? 'ko' : ''} ${player.lastReceived > 0 ? 'received' : ''}`}>
      <header className="player-header">
        <div>
          <h2>{player.name}</h2>
          <span>{player.id.toUpperCase()} · {player.kind.toUpperCase()}</span>
        </div>
        <div className="badge-stack">
          {selectedTarget === player.id ? <strong className="target-badge">TARGET</strong> : null}
          {player.lastReceived > 0 ? <strong className="recv-badge">+{player.lastReceived}</strong> : null}
        </div>
      </header>
      <div className="board" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
        {cells.flatMap((row, rowIndex) =>
          row.map((cell, colIndex) => (
            <span
              key={`${rowIndex}-${colIndex}`}
              className={cell === 0 ? 'cell' : cell === 8 ? 'cell garbage' : 'cell filled'}
              style={cell > 0 ? { backgroundColor: PIECE_COLORS[cell] } : undefined}
            />
          )),
        )}
      </div>
      <footer className="player-stats">
        <Metric label="Score" value={player.score} />
        <Metric label="Lines" value={player.lines} />
        <Metric label="Queue" value={player.pendingGarbage} />
        <Metric label="Sent" value={player.lastSent} />
        <Metric label="Recv" value={player.lastReceived} />
        <Metric label="Piece" value={player.piece} />
        <Metric label="KO" value={player.ko ? 'yes' : 'no'} />
        {player.ko ? <Metric label="Reason" value={player.koReason ?? 'unknown'} /> : null}
      </footer>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="metric">
      <small>{label}</small>
      <b>{value}</b>
    </span>
  );
}

function GarbageBank({ amount }: { amount: number }) {
  const visibleSlots = 8;
  const filledSlots = Math.min(amount, visibleSlots);
  return (
    <div className="garbage-bank" aria-label={`Available garbage ${amount}`}>
      <div className="garbage-bank-label">
        <span>Available garbage</span>
        <strong>{amount}</strong>
      </div>
      <div className="garbage-bank-meter" aria-hidden="true">
        {Array.from({ length: visibleSlots }, (_, index) => (
          <span key={index} className={index < filledSlots ? 'filled' : ''} />
        ))}
      </div>
    </div>
  );
}

function SourceReview() {
  return (
    <section className="review-workbench" aria-label="Source review">
      <CodeComparison />
    </section>
  );
}

function CodeComparison() {
  const [leftTab, setLeftTab] = useState<'veriscope' | 'engine'>('veriscope');
  const [rightTab, setRightTab] = useState<'react' | 'svelte' | 'solid'>('react');

  return (
    <div className="code-compare">
      <div className="code-pane">
        <TabRow
          tabs={[
            ['veriscope', 'React + Veriscope'],
            ['engine', 'Game Engine'],
          ]}
          active={leftTab}
          onSelect={tab => setLeftTab(tab as typeof leftTab)}
        />
        <CodeBlock source={leftSources[leftTab]} />
      </div>
      <div className="code-pane">
        <TabRow
          tabs={[
            ['react', 'React'],
            ['svelte', 'Svelte'],
            ['solid', 'Solid'],
          ]}
          active={rightTab}
          onSelect={tab => setRightTab(tab as typeof rightTab)}
        />
        <CodeBlock source={rightSources[rightTab]} />
        <div className="code-footnote">
          These tabs load complete source files for the same arena. Plain ports omit only the Veriscope observability APIs.
        </div>
      </div>
    </div>
  );
}

function CodeBlock({ source }: { source: string }) {
  const lines = source.trimEnd().split('\n');
  return (
    <div className="code-block">
      <div className="code-meta">{lines.length} lines</div>
      <pre>
        {lines.map((line, index) => (
          <span key={index} className="code-line">
            <span className="line-no">{index + 1}</span>
            <code dangerouslySetInnerHTML={{ __html: highlightLine(line) || '&nbsp;' }} />
          </span>
        ))}
      </pre>
    </div>
  );
}

function highlightLine(line: string): string {
  let html = escapeHtml(line);
  const commentIndex = html.indexOf('//');
  let comment = '';
  if (commentIndex >= 0) {
    comment = html.slice(commentIndex);
    html = html.slice(0, commentIndex);
  }

  html = html
    .replace(/(&quot;.*?&quot;|'.*?'|`.*?`)/g, '<span class="tok-string">$1</span>')
    .replace(/\b(import|export|from|const|let|function|return|if|else|for|while|type|interface|extends|as|async|await|true|false|null|undefined)\b/g, '<span class="tok-keyword">$1</span>')
    .replace(/\b(useSignal|useDerived|assertAlways|assertAfter|advanceArena|sendManualGarbage|garbageFromClearedLines|createSignal|createMemo)\b/g, '<span class="tok-call">$1</span>')
    .replace(/\b([A-Z][A-Za-z0-9_]*)\b/g, '<span class="tok-type">$1</span>');

  if (comment) html += `<span class="tok-comment">${comment}</span>`;
  return html;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function TabRow({
  tabs,
  active,
  onSelect,
}: {
  tabs: Array<[string, string]>;
  active: string;
  onSelect: (tab: string) => void;
}) {
  return (
    <div className="tab-row">
      {tabs.map(([id, label]) => (
        <button key={id} className={active === id ? 'tab active' : 'tab'} onClick={() => onSelect(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function EmbeddedDevtools({ opponentCount }: { opponentCount: OpponentCount }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const opponentCountRef = useRef(opponentCount);

  useEffect(() => {
    opponentCountRef.current = opponentCount;
  }, [opponentCount]);

  useEffect(() => {
    if (!hostRef.current) return;
    const handle = mountDevtools(hostRef.current, graph, {
      coverage,
      autotest: (_liveGraph, options) => runAutotest(
        createVsTetrisGraph(clampOpponentCount(opponentCountRef.current)),
        options,
      ),
      mutate: options => runMutationTest(
        () => createVsTetrisGraph(clampOpponentCount(opponentCountRef.current)),
        {
          budget: 1200,
          operators: options?.mode === 'broad' ? 'all' : undefined,
          onProgress: options?.onProgress,
        },
      ),
      initialTab: 'circuit',
      height: '380px',
    });
    const id = window.setInterval(() => handle.refresh(), 700);
    return () => {
      window.clearInterval(id);
      handle.dispose();
    };
  }, []);

  return (
    <section className="devtools-shell" aria-label="Veriscope devtools">
      <div ref={hostRef} />
    </section>
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
      if (y >= 0 && y < ROWS && x >= 0 && x < COLS) {
        board[y][x] = color;
      }
    }
  }
  return board;
}
