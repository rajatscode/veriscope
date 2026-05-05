import type { MutateResult } from './index.js';

interface MutantsPanelOptions {
  mutate?: () => Promise<MutateResult>;
}

interface MutationRunStatus {
  number: number;
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  startedAtMs: number;
  finishedAt?: Date;
  durationMs?: number;
  generatedMutants?: number;
  budgetPerMutation?: number;
  autotestRuns?: number;
  autotestSteps?: number;
  seed?: string | number;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function percent(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : 'n/a';
}

function formatClock(value: Date): string {
  return value.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(ms: number | undefined): string {
  if (!Number.isFinite(ms)) return 'n/a';
  if ((ms ?? 0) < 1000) return `${Math.max(0, Math.round(ms ?? 0))}ms`;
  return `${((ms ?? 0) / 1000).toFixed(2)}s`;
}

function mutationSeedText(seed: string | number | undefined): string {
  return seed === undefined ? 'deterministic/no seed reported' : String(seed);
}

function waitForPaint(): Promise<void> {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

export function createMutantsPanel(
  container: HTMLElement,
  options?: MutantsPanelOptions,
): { dispose: () => void; refresh: () => void } {
  container.style.cssText = 'height:100%; overflow-y:auto; padding:12px; font-family:"SF Mono","Fira Code",monospace; font-size:0.8rem;';

  let disposed = false;
  let running = false;
  let result: MutateResult | null = null;
  let error: string | null = null;
  let runNumber = 0;
  let activeRun: MutationRunStatus | null = null;
  let lastRun: MutationRunStatus | null = null;
  let liveTimer: ReturnType<typeof setInterval> | null = null;

  function stopLiveTimer() {
    if (liveTimer) {
      clearInterval(liveTimer);
      liveTimer = null;
    }
  }

  function startLiveTimer() {
    stopLiveTimer();
    liveTimer = setInterval(() => {
      if (!disposed && activeRun) render();
    }, 250);
  }

  async function run() {
    if (!options?.mutate || running) return;
    const startedAt = new Date();
    const startedAtMs = performance.now();
    runNumber++;
    activeRun = {
      number: runNumber,
      status: 'running',
      startedAt,
      startedAtMs,
    };
    running = true;
    error = null;
    render();
    startLiveTimer();
    try {
      await waitForPaint();
      if (disposed) return;
      const nextResult = await options.mutate();
      result = nextResult;
      lastRun = {
        number: runNumber,
        status: 'completed',
        startedAt,
        startedAtMs,
        finishedAt: new Date(),
        durationMs: performance.now() - startedAtMs,
        generatedMutants: nextResult.total,
        budgetPerMutation: nextResult.budgetPerMutation,
        autotestRuns: nextResult.autotestRuns,
        autotestSteps: nextResult.autotestSteps,
        seed: nextResult.seed,
      };
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      lastRun = {
        number: runNumber,
        status: 'failed',
        startedAt,
        startedAtMs,
        finishedAt: new Date(),
        durationMs: performance.now() - startedAtMs,
      };
    } finally {
      stopLiveTimer();
      activeRun = null;
      running = false;
      render();
    }
  }

  function renderRunStatus(status: MutationRunStatus, hasPreviousResult: boolean): HTMLElement {
    const box = document.createElement('div');
    const isRunning = status.status === 'running';
    const isFailed = status.status === 'failed';
    box.style.cssText = `
      color:${isFailed ? '#ff5d8f' : isRunning ? '#f8d66d' : '#8b949e'};
      padding:8px;
      background:${isFailed ? 'rgba(255,93,143,0.08)' : isRunning ? 'rgba(248,214,109,0.08)' : 'rgba(255,255,255,0.03)'};
      border:1px solid ${isFailed ? 'rgba(255,93,143,0.2)' : isRunning ? 'rgba(248,214,109,0.2)' : '#21262d'};
      border-radius:4px;
      margin-bottom:10px;
      font-size:0.72rem;
      line-height:1.45;
    `;

    if (isRunning) {
      box.innerHTML = `
        <div style="color:#f8d66d; font-weight:600;">Run #${status.number} running</div>
        <div>Started: ${escapeHtml(formatClock(status.startedAt))}</div>
        <div>Elapsed: ${escapeHtml(formatDuration(performance.now() - status.startedAtMs))}</div>
        <div>Applying generated mutations and running the full autotest budget against each mutant.</div>
        ${hasPreviousResult ? '<div>Showing the previous completed result until this run finishes.</div>' : ''}
      `;
      return box;
    }

    const finished = status.finishedAt ? formatClock(status.finishedAt) : 'n/a';
    const generated = status.generatedMutants === undefined ? 'n/a' : String(status.generatedMutants);
    const budget = status.budgetPerMutation === undefined ? 'n/a' : String(status.budgetPerMutation);
    const runs = status.autotestRuns === undefined ? 'n/a' : String(status.autotestRuns);
    const steps = status.autotestSteps === undefined ? 'n/a' : String(status.autotestSteps);
    box.innerHTML = `
      <div style="font-weight:600;">Last run: #${status.number} ${status.status}</div>
      <div>Started: ${escapeHtml(formatClock(status.startedAt))} · Finished: ${escapeHtml(finished)} · Duration: ${escapeHtml(formatDuration(status.durationMs))}</div>
      <div>Generated mutants: ${escapeHtml(generated)} · Seed: ${escapeHtml(mutationSeedText(status.seed))}</div>
      <div>Autotest runs: ${escapeHtml(runs)} · Budget per mutant: ${escapeHtml(budget)} · Total autotest steps: ${escapeHtml(steps)}</div>
    `;
    return box;
  }

  function renderList(
    title: string,
    items: Array<{ mutation: string; description: string; scenarioId?: string; assertionName?: string; error?: string; reason?: string }>,
    color: string,
  ): HTMLElement {
    const box = document.createElement('div');
    box.style.cssText = 'margin-top:10px;';

    const heading = document.createElement('div');
    heading.style.cssText = `color:${color}; font-weight:600; margin-bottom:5px;`;
    heading.textContent = `${title} (${items.length})`;
    box.appendChild(heading);

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#666; padding:6px 0;';
      empty.textContent = 'None';
      box.appendChild(empty);
      return box;
    }

    for (const item of items) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:6px 8px; margin-bottom:4px; background:rgba(255,255,255,0.03); border:1px solid #21262d; border-radius:4px; font-size:0.7rem;';
      const detail = [
        item.assertionName ? `assertion ${item.assertionName}` : null,
        item.scenarioId ? `scenario ${item.scenarioId}` : null,
        item.error ? `error ${item.error}` : null,
        item.reason ? `reason ${item.reason}` : null,
      ].filter(Boolean).join(' · ');
      row.innerHTML = `
        <div style="color:#c9d1d9;">${escapeHtml(item.mutation)}</div>
        <div style="color:#8b949e; margin-top:2px;">${escapeHtml(item.description)}</div>
        ${detail ? `<div style="color:#666; margin-top:2px;">${escapeHtml(detail)}</div>` : ''}
      `;
      box.appendChild(row);
    }
    return box;
  }

  function render() {
    if (disposed) return;
    container.innerHTML = '';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:12px;';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:0.9rem; font-weight:600; color:#c9d1d9;';
    title.textContent = 'Mutants';
    header.appendChild(title);

    const runBtn = document.createElement('button');
    runBtn.textContent = running ? 'Running...' : result ? 'Rerun Mutants' : 'Run Mutants';
    runBtn.disabled = running || !options?.mutate;
    runBtn.style.cssText = `
      background:#21262d; border:1px solid #30363d; color:#c9d1d9;
      padding:3px 10px; border-radius:4px; cursor:${runBtn.disabled ? 'not-allowed' : 'pointer'};
      font-size:0.75rem; opacity:${runBtn.disabled ? '0.55' : '1'};
    `;
    runBtn.addEventListener('click', run);
    header.appendChild(runBtn);
    container.appendChild(header);

    if (!options?.mutate) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#8b949e; padding:14px; background:rgba(255,255,255,0.03); border:1px solid #21262d; border-radius:4px; line-height:1.45;';
      empty.textContent = 'No mutation runner is registered for this graph. Pass a callback backed by @veriscope/mutate to enable this panel.';
      container.appendChild(empty);
      return;
    }

    if (activeRun) {
      container.appendChild(renderRunStatus(activeRun, result !== null));
    } else if (lastRun) {
      container.appendChild(renderRunStatus(lastRun, false));
    }

    if (error) {
      const errorBox = document.createElement('div');
      errorBox.style.cssText = 'color:#ff5d8f; padding:8px; background:rgba(255,93,143,0.08); border:1px solid rgba(255,93,143,0.2); border-radius:4px; margin-bottom:10px;';
      errorBox.textContent = error;
      container.appendChild(errorBox);
    }

    if (!result) {
      const hint = document.createElement('div');
      hint.style.cssText = 'color:#666; padding:20px; text-align:center;';
      hint.textContent = running ? 'Applying generated mutations and running full autotests per mutant...' : 'Run mutation testing to see killed and surviving generated mutations.';
      container.appendChild(hint);
      return;
    }

    const summary = document.createElement('div');
    summary.style.cssText = 'display:flex; gap:12px; flex-wrap:wrap; padding:8px; background:rgba(255,255,255,0.03); border:1px solid #21262d; border-radius:4px; font-size:0.75rem;';
    summary.innerHTML = `
      <span style="color:#c9d1d9;">Score: <strong style="color:${result.score >= 80 ? '#72f1b8' : result.score >= 50 ? '#f8d66d' : '#ff5d8f'}">${percent(result.score)}</strong></span>
      <span style="color:#72f1b8;">Killed: ${result.killed}</span>
      <span style="color:#ff5d8f;">Survived: ${result.survived.length}</span>
      <span style="color:#8b949e;">Total: ${result.total}</span>
      <span style="color:#8b949e;">Invalid: ${result.invalid?.length ?? 0}</span>
      <span style="color:#8b949e;">Equivalent: ${result.equivalent?.length ?? 0}</span>
      ${result.budgetPerMutation !== undefined ? `<span style="color:#8b949e;">Budget/mutant: ${escapeHtml(result.budgetPerMutation)}</span>` : ''}
      ${result.autotestRuns !== undefined ? `<span style="color:#8b949e;">Autotest runs: ${escapeHtml(result.autotestRuns)}</span>` : ''}
      ${result.autotestSteps !== undefined ? `<span style="color:#8b949e;">Autotest steps: ${escapeHtml(result.autotestSteps)}</span>` : ''}
    `;
    container.appendChild(summary);

    const rerunNote = document.createElement('div');
    rerunNote.style.cssText = 'color:#8b949e; margin-top:6px; font-size:0.7rem;';
    rerunNote.textContent = 'Mutation testing is rerunnable; rerun replaces these results with a fresh generated mutation run.';
    container.appendChild(rerunNote);

    container.appendChild(renderList('Killed', result.killedMutations, '#72f1b8'));
    container.appendChild(renderList('Survived', result.survived, '#ff5d8f'));
    if (result.invalid && result.invalid.length > 0) {
      container.appendChild(renderList('Invalid', result.invalid, '#f8d66d'));
    }
    if (result.equivalent && result.equivalent.length > 0) {
      container.appendChild(renderList('Equivalent', result.equivalent, '#8b949e'));
    }
  }

  render();

  return {
    dispose() {
      disposed = true;
      stopLiveTimer();
      container.innerHTML = '';
    },
    refresh() {
      render();
    },
  };
}
