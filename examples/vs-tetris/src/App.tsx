import { useEffect, useMemo, useRef, useState } from 'react';
import { assertAfter, assertAlways, coverage, graph } from '@veriscope/graph';
import { generateMutations } from '@veriscope/mutate';
import { useDerived, useSignal, useTrackedEffect } from '@veriscope/react';
import type { ReadonlySignal } from '@veriscope/graph';
import { mountDevtools } from '@veriscope/devtools';
import { leftSources, rightSources } from './reviewSources';
import {
  COLS,
  PIECE_COLORS,
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
} from './tetris';

const TARGETS: PlayerId[] = ['p2', 'p3', 'p4'];

interface PlayerMetricSignals {
  score: { val: number };
  lines: { val: number };
  pending: { val: number };
  lastSent: { val: number };
  piece: { val: string };
  ko: { val: boolean };
}

function usePlayerMetrics(player: ReadonlySignal<PlayerState>, id: PlayerId): PlayerMetricSignals {
  return {
    score: useDerived(() => player.val.score, [player], `${id}.score`),
    lines: useDerived(() => player.val.lines, [player], `${id}.lines`),
    pending: useDerived(() => player.val.pendingGarbage, [player], `${id}.pendingGarbage`),
    lastSent: useDerived(() => player.val.lastSent, [player], `${id}.lastSent`),
    piece: useDerived(() => player.val.piece, [player], `${id}.piece`),
    ko: useDerived(() => player.val.ko, [player], `${id}.ko`),
  };
}

export function App() {
  const initialized = useRef(false);
  if (!initialized.current) {
    graph.reset();
    graph.enableCoverage();
    initialized.current = true;
  }

  const initialPlayers = useMemo(() => resetPlayers(), []);
  const p1 = useSignal(initialPlayers[0], 'p1.state');
  const p2 = useSignal(initialPlayers[1], 'p2.state');
  const p3 = useSignal(initialPlayers[2], 'p3.state');
  const p4 = useSignal(initialPlayers[3], 'p4.state');
  const humanTarget = useSignal<PlayerId>('p2', 'arena.humanTarget', { states: TARGETS });
  const arenaTick = useSignal(0, 'arena.tick');
  const paused = useSignal(false, 'arena.paused');
  const garbagePulse = useSignal(false, 'arena.garbagePulse');
  const attackBank = useSignal(0, 'p1.attackBank');

  const players = [p1, p2, p3, p4] as const;
  const metrics = {
    p1: usePlayerMetrics(p1, 'p1'),
    p2: usePlayerMetrics(p2, 'p2'),
    p3: usePlayerMetrics(p3, 'p3'),
    p4: usePlayerMetrics(p4, 'p4'),
  };
  const totalPending = useDerived(
    () => players.reduce((sum, player) => sum + player.val.pendingGarbage, 0),
    [...players],
    'arena.totalPendingGarbage',
  );
  const activePlayers = useDerived(
    () => players.filter(player => !player.val.ko).length,
    [...players],
    'arena.activePlayers',
  );
  const leader = useDerived(
    () => [...players].sort((a, b) => b.val.score - a.val.score)[0].val.id,
    [...players],
    'arena.leader',
  );
  const winner = useDerived(
    () => {
      const active = players.filter(player => !player.val.ko);
      return active.length === 1 ? active[0].val.id : null;
    },
    [...players],
    'arena.winner',
  );
  useTrackedEffect(
    () => {
      document.title = winner.val ? `Winner ${winner.val.toUpperCase()} · VS Tetris` : `Tick ${arenaTick.val} · VS Tetris`;
    },
    [arenaTick, winner],
    'document-title-effect',
  );

  const [sendLog, setSendLog] = useState<GarbageSend[]>([]);
  const [autoTest, setAutoTest] = useState<AutoTestRun | null>(null);
  const [mutationRun, setMutationRun] = useState<MutationRun | null>(null);
  const stepRef = useRef<() => void>(() => {});

  function currentPlayers(): PlayerState[] {
    return players.map(player => player.val);
  }

  function commit(nextPlayers: PlayerState[], sends: GarbageSend[]) {
    p1.set(nextPlayers[0]);
    p2.set(nextPlayers[1]);
    p3.set(nextPlayers[2]);
    p4.set(nextPlayers[3]);
    arenaTick.set(arenaTick.val + 1);

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
    const result = advanceArena(currentPlayers(), humanTarget.val, { holdHumanGarbage: true });
    const earned = garbageFromClearedLines(result.players[0].lastCleared);
    commit(result.players, result.sends);
    if (earned > 0) {
      attackBank.set(attackBank.val + earned);
    }
  }

  function resetArena() {
    const next = resetPlayers();
    commit(next, []);
    arenaTick.set(0);
    attackBank.set(0);
    paused.set(false);
    setSendLog([]);
  }

  function sendGarbage(lines: number) {
    if (attackBank.val < lines) return;
    const target = players.find(player => player.val.id === humanTarget.val);
    if (!target || target.val.ko) return;

    const result = sendManualGarbage(currentPlayers(), 'p1', humanTarget.val, lines);
    if (result.sends.length === 0) return;
    attackBank.set(attackBank.val - lines);
    commit(result.players, result.sends);
  }

  function updateHuman(nextHuman: PlayerState) {
    const newlyCleared = Math.max(0, nextHuman.lines - p1.val.lines);
    const earned = garbageFromClearedLines(newlyCleared);
    p1.set(nextHuman);
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
    const assertionIds = [
      assertAlways(
        () => players.every(player => player.val.score >= 0 && player.val.pendingGarbage >= 0),
        'scores-and-garbage-nonnegative',
        graph,
        [...players],
      ),
      assertAlways(
        () => humanTarget.val !== 'p1',
        'human-never-targets-self',
        graph,
        [humanTarget],
      ),
      assertAlways(
        () => players.every(player => player.val.pendingGarbage <= 20),
        'garbage-queue-bounded',
        graph,
        [...players],
      ),
      assertAfter(
        garbagePulse,
        'posedge',
        'immediately',
        () => totalPending.val > 0 || players.some(player => player.val.lastReceived > 0),
        { name: 'garbage-send-has-recipient' },
        graph,
      ),
    ];

    return () => {
      for (const id of assertionIds) graph.disposeNode(id);
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => stepRef.current(), 520);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (p1.val.ko) return;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        updateHuman(move(p1.val, -1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        updateHuman(move(p1.val, 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        updateHuman(rotate(p1.val));
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        updateHuman(softDrop(p1.val));
      } else if (event.key === ' ') {
        event.preventDefault();
        updateHuman(hardDrop(p1.val));
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const selectedTarget = players.find(player => player.val.id === humanTarget.val);
  const selectedTargetKo = selectedTarget?.val.ko ?? true;
  const canSend2 = attackBank.val >= 2 && !selectedTargetKo;
  const canSend4 = attackBank.val >= 4 && !selectedTargetKo;

  return (
    <main className="app-shell">
      <section className="arena-toolbar" aria-label="Arena controls">
        <div className="brand-lockup">
          <span className="brand-title">VS Tetris</span>
          <span className="brand-subtitle">
            Tick {arenaTick.val} · Leader {leader.val.toUpperCase()} · Active {activePlayers.val}
            {winner.val ? ` · Winner ${winner.val.toUpperCase()}` : ''}
          </span>
        </div>
        <div className="target-control" aria-label="Garbage target">
          {TARGETS.map(target => (
            <button
              key={target}
              className={humanTarget.val === target ? 'target-button active' : 'target-button'}
              onClick={() => humanTarget.set(target)}
            >
              {target.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="send-control">
          <GarbageBank amount={attackBank.val} />
          <div className="command-row">
            <button className={canSend2 ? 'attack-ready' : ''} disabled={!canSend2} onClick={() => sendGarbage(2)}>Send 2 to {humanTarget.val.toUpperCase()}</button>
            <button className={canSend4 ? 'attack-ready' : ''} disabled={!canSend4} onClick={() => sendGarbage(4)}>Send 4 to {humanTarget.val.toUpperCase()}</button>
            <button onClick={() => stepRef.current()}>Step</button>
            <button onClick={() => paused.set(!paused.val)}>{paused.val ? 'Run' : 'Pause'}</button>
            <button onClick={resetArena}>Reset</button>
          </div>
        </div>
      </section>

      <section className="arena-grid" aria-label="Players">
        {players.map(player => (
          <PlayerBoard key={player.val.id} player={player.val} metrics={metrics[player.val.id]} selectedTarget={humanTarget.val} />
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
        <GraphVitals />
      </section>

      <LiveGraphPanel />

      <ReviewWorkbench
        sendLog={sendLog}
        onRunAutotest={() => setAutoTest(runAutotest())}
        autoTest={autoTest}
        onRunMutations={() => setMutationRun(runMutationSuite())}
        mutationRun={mutationRun}
      />

      <EmbeddedDevtools />
    </main>
  );
}

function PlayerBoard({
  player,
  metrics,
  selectedTarget,
}: {
  player: PlayerState;
  metrics: PlayerMetricSignals;
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
        <Metric label="Score" value={metrics.score.val} />
        <Metric label="Lines" value={metrics.lines.val} />
        <Metric label="Queue" value={metrics.pending.val} />
        <Metric label="Sent" value={metrics.lastSent.val} />
        <Metric label="Recv" value={player.lastReceived} />
        <Metric label="Piece" value={metrics.piece.val} />
        <Metric label="KO" value={metrics.ko.val ? 'yes' : 'no'} />
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

function GraphVitals() {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const unsubscribe = graph.subscribe(() => setVersion(v => (v + 1) % 100000));
    const id = window.setInterval(() => setVersion(v => (v + 1) % 100000), 600);
    return () => {
      unsubscribe();
      window.clearInterval(id);
    };
  }, []);

  const nodes = graph.getNodes();
  const edges = graph.getEdges();
  const events = graph.getRecentEvents(6);
  const assertions = graph.getAssertions();
  const mutants = generateMutations(graph).length;

  return (
    <div className="telemetry-panel" data-version={version}>
      <div className="panel-title">Graph</div>
      <div className="signal-grid compact">
        <Metric label="Nodes" value={nodes.length} />
        <Metric label="Edges" value={edges.length} />
        <Metric label="Tick" value={graph.currentTick} />
        <Metric label="Asserts" value={assertions.length} />
        <Metric label="Mutants" value={mutants} />
      </div>
      <div className="event-list">
        {events.map((event, index) => (
          <span key={`${event.tick}-${event.nodeId}-${index}`}>
            t{event.tick} {event.type.replace('-', ' ')}
          </span>
        ))}
      </div>
    </div>
  );
}

function LiveGraphPanel() {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const unsubscribe = graph.subscribe(() => setVersion(v => (v + 1) % 100000));
    const id = window.setInterval(() => setVersion(v => (v + 1) % 100000), 500);
    return () => {
      unsubscribe();
      window.clearInterval(id);
    };
  }, []);

  const nodes = graph.getNodes();
  const edges = graph.getEdges();
  const recentIds = new Set(graph.getRecentEvents(18).map(event => event.nodeId));
  const lanes = ['signal', 'derived', 'assertion', 'effect'] as const;
  const width = 1120;
  const laneWidth = width / lanes.length;
  const rowGap = 68;
  const top = 58;
  const laneNodes = new Map(lanes.map(type => [type, nodes.filter(node => node.type === type)]));
  const maxRows = Math.max(1, ...lanes.map(type => laneNodes.get(type)!.length));
  const height = Math.max(250, top + maxRows * rowGap + 28);
  const positions = new Map<string, { x: number; y: number }>();

  lanes.forEach((type, laneIndex) => {
    laneNodes.get(type)!.forEach((node, rowIndex) => {
      positions.set(node.id, {
        x: laneIndex * laneWidth + laneWidth / 2,
        y: top + rowIndex * rowGap,
      });
    });
  });

  return (
    <section className="live-graph-panel" aria-label="Live Veriscope graph" data-version={version}>
      <div className="graph-panel-header">
        <div>
          <span className="panel-title">Live Graph</span>
          <p>Generated from Veriscope runtime registration: {nodes.length} nodes · {edges.length} edges · recent events glow</p>
        </div>
      </div>
      <div className="graph-scroll">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Veriscope dependency graph">
          {lanes.map((type, index) => (
            <g key={type}>
              <rect className={`graph-lane ${type}`} x={index * laneWidth + 10} y="10" width={laneWidth - 20} height={height - 20} rx="8" />
              <text className="graph-lane-title" x={index * laneWidth + 24} y="34">{type}</text>
            </g>
          ))}

          {edges.map((edge, index) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (!from || !to) return null;
            const mid = (from.x + to.x) / 2;
            return (
              <path
                key={`${edge.from}-${edge.to}-${index}`}
                className="graph-edge"
                d={`M ${from.x + 72} ${from.y} C ${mid} ${from.y}, ${mid} ${to.y}, ${to.x - 72} ${to.y}`}
              />
            );
          })}

          {nodes.map(node => {
            const pos = positions.get(node.id);
            if (!pos) return null;
            const value = readNodeValue(node.id);
            return (
              <g key={node.id} className={`graph-node ${node.type} ${recentIds.has(node.id) ? 'hot' : ''}`} transform={`translate(${pos.x - 70}, ${pos.y - 22})`}>
                <rect width="140" height="44" rx="7" />
                <text className="graph-node-name" x="10" y="17">{node.name}</text>
                <text className="graph-node-value" x="10" y="34">{value}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

function readNodeValue(nodeId: string): string {
  const node = graph.getNode(nodeId);
  if (!node?.getValue) return node?.type ?? '';
  try {
    const value = node.getValue();
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number' || typeof value === 'string') return String(value).slice(0, 26);
    if (value && typeof value === 'object' && 'id' in value) {
      const maybePlayer = value as { id?: string; score?: number; pendingGarbage?: number; ko?: boolean };
      return `${maybePlayer.id} score:${maybePlayer.score ?? 0} q:${maybePlayer.pendingGarbage ?? 0}${maybePlayer.ko ? ' KO' : ''}`;
    }
    return JSON.stringify(value).slice(0, 26);
  } catch {
    return 'unreadable';
  }
}

interface AutoTestRun {
  steps: number;
  checks: number;
  violations: string[];
  targetCoverage: Record<PlayerId, boolean>;
  rows: Array<{ name: string; status: 'pass' | 'fail'; detail: string }>;
}

interface MutationRun {
  total: number;
  killed: number;
  score: number;
  rows: Array<{ name: string; status: 'killed' | 'survived'; detail: string }>;
}

function ReviewWorkbench({
  sendLog,
  onRunAutotest,
  autoTest,
  onRunMutations,
  mutationRun,
}: {
  sendLog: GarbageSend[];
  onRunAutotest: () => void;
  autoTest: AutoTestRun | null;
  onRunMutations: () => void;
  mutationRun: MutationRun | null;
}) {
  return (
    <section className="review-workbench" aria-label="Review workbench">
      <CodeComparison />
      <div className="review-grid">
        <LiveCoverageMap sendLog={sendLog} autoTest={autoTest} />
        <RunnerPanel
          title="Autotest"
          action="Run Autotest"
          onRun={onRunAutotest}
          stats={autoTest ? [
            ['Steps', autoTest.steps],
            ['Checks', autoTest.checks],
            ['Violations', autoTest.violations.length],
            ['Targets', Object.values(autoTest.targetCoverage).filter(Boolean).length],
          ] : []}
          rows={autoTest?.rows.map(row => ({
            name: row.name,
            status: row.status,
            detail: row.detail,
          })) ?? []}
        />
        <RunnerPanel
          title="Mutations"
          action="Run Mutations"
          onRun={onRunMutations}
          stats={mutationRun ? [
            ['Total', mutationRun.total],
            ['Killed', mutationRun.killed],
            ['Score', `${mutationRun.score.toFixed(0)}%`],
          ] : []}
          rows={mutationRun?.rows.map(row => ({
            name: row.name,
            status: row.status,
            detail: row.detail,
          })) ?? []}
        />
      </div>
    </section>
  );
}

function CodeComparison() {
  const [leftTab, setLeftTab] = useState<'veriscope' | 'harness' | 'engine'>('veriscope');
  const [rightTab, setRightTab] = useState<'react' | 'svelte' | 'solid'>('react');

  return (
    <div className="code-compare">
      <div className="code-pane">
        <TabRow
          tabs={[
            ['veriscope', 'React + Veriscope'],
            ['harness', 'Review Harness'],
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

function LiveCoverageMap({ sendLog, autoTest }: { sendLog: GarbageSend[]; autoTest: AutoTestRun | null }) {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setVersion(v => (v + 1) % 100000), 700);
    return () => window.clearInterval(id);
  }, []);

  const report = coverage.getReport();
  const liveTargets = new Set(sendLog.filter(send => send.from === 'p1').map(send => send.to));
  const autoTargets = autoTest?.targetCoverage ?? { p1: false, p2: false, p3: false, p4: false };

  return (
    <div className="runner-panel" data-version={version}>
      <div className="runner-header">
        <span>Coverage</span>
        <b>{report.summary.percentage.toFixed(0)}%</b>
      </div>
      <div className="coverage-bins">
        {TARGETS.map(target => (
          <span key={target} className={liveTargets.has(target) || autoTargets[target] ? 'bin hit' : 'bin'}>
            {target.toUpperCase()}
          </span>
        ))}
        <span className={report.toggle.some(t => t.seenTrue && t.seenFalse) ? 'bin hit' : 'bin'}>toggle</span>
        <span className={report.transitions.length > 0 ? 'bin hit' : 'bin'}>fsm</span>
        <span className={report.cross.some(c => c.observed.size > 0) ? 'bin hit' : 'bin'}>cross</span>
      </div>
      <div className="coverage-table">
        <span>Toggle points</span><b>{report.toggle.length}</b>
        <span>Transition maps</span><b>{report.transitions.length}</b>
        <span>Cross groups</span><b>{report.cross.length}</b>
        <span>Covered points</span><b>{report.summary.coveredPoints}/{report.summary.totalPoints}</b>
      </div>
    </div>
  );
}

function RunnerPanel({
  title,
  action,
  onRun,
  stats,
  rows,
}: {
  title: string;
  action: string;
  onRun: () => void;
  stats: Array<[string, string | number]>;
  rows: Array<{ name: string; status: string; detail: string }>;
}) {
  return (
    <div className="runner-panel">
      <div className="runner-header">
        <span>{title}</span>
        <button onClick={onRun}>{action}</button>
      </div>
      <div className="runner-stats">
        {stats.length === 0 ? <span className="empty-row">idle</span> : stats.map(([label, value]) => (
          <Metric key={label} label={label} value={value} />
        ))}
      </div>
      <div className="runner-rows">
        {rows.length === 0 ? <span className="empty-row">No run data</span> : rows.map(row => (
          <span key={row.name} className={`runner-row ${row.status}`}>
            <b>{row.status}</b>
            <em>{row.name}</em>
            <small>{row.detail}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

function EmbeddedDevtools() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const handle = mountDevtools(hostRef.current, graph, {
      coverage,
      initialTab: 'waveform',
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

function runAutotest(): AutoTestRun {
  const rows: AutoTestRun['rows'] = [];
  const violations: string[] = [];
  const targetCoverage: Record<PlayerId, boolean> = { p1: false, p2: false, p3: false, p4: false };
  let steps = 0;
  let checks = 0;

  function check(name: string, passed: boolean, detail: string) {
    checks++;
    rows.push({ name, status: passed ? 'pass' : 'fail', detail });
    if (!passed) violations.push(name);
  }

  for (const target of TARGETS) {
    for (const lines of [2, 4]) {
      const start = resetPlayers();
      const sent = sendManualGarbage(start, 'p1', target, lines);
      steps++;
      const receiver = sent.players.find(player => player.id === target)!;
      const others = sent.players.filter(player => player.id !== target && player.id !== 'p1');

      targetCoverage[target] = receiver.pendingGarbage === lines;
      check(`route ${lines} to ${target}`, receiver.pendingGarbage === lines, `${receiver.pendingGarbage} queued`);
      check(`isolate ${target}`, others.every(player => player.pendingGarbage === 0), 'non-target queues unchanged');

      let players = sent.players;
      for (let i = 0; i < 10; i++) {
        const advanced = advanceArena(players, target);
        players = advanced.players;
        steps++;
        check(
          `tick ${target} ${i + 1}`,
          players.every(player => player.score >= 0 && player.pendingGarbage >= 0),
          'nonnegative score and queue',
        );
      }
    }
  }

  return { steps, checks, violations, targetCoverage, rows };
}

function runMutationSuite(): MutationRun {
  const rows: MutationRun['rows'] = [];
  const mutations = generateMutations(graph).slice(0, 24);

  let killed = 0;
  for (const mutation of mutations) {
    const undo = mutation.apply(graph);
    const violations = graph.checkAssertions();
    const wasKilled = violations.length > 0;
    if (wasKilled) killed++;
    rows.push({
      name: mutation.name,
      status: wasKilled ? 'killed' : 'survived',
      detail: wasKilled ? `${violations.length} assertion violation(s)` : mutation.description,
    });
    undo();
  }

  return {
    total: mutations.length,
    killed,
    score: mutations.length > 0 ? (killed / mutations.length) * 100 : 100,
    rows,
  };
}
