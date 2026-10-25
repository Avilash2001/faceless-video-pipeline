import { html, raw } from 'hono/html';
import { STARTED_BY, type RunRecord } from '../db/runs.js';
import type { RecordedEvolve } from '../db/strategyHistory.js';
import { GENRES } from '../genres.js';
import type { StrategyRules } from '../types.js';
import type { ActiveAlert } from './alerts.js';
import { formatLocalTime } from './localTime.js';

type Html = ReturnType<typeof html>;

export interface FrontPage {
  now: Date;
  startedAt: Date;
  /** Each scheduled task and when it next comes due. */
  nextUp: { name: string; due: Date }[];
  /** Active Alerts, oldest first; shown above everything else. */
  alerts: ActiveAlert[];
  /** Whether pm2 runs the daemon, so Restart would bring it back. */
  canRestart: boolean;
  /** The latest Runs, newest first. */
  recentRuns: RunRecord[];
}

export function frontPage({ now, startedAt, nextUp, alerts, canRestart, recentRuns }: FrontPage): Html {
  return layout(
    'Dashboard',
    html`
      ${alerts.length > 0
        ? html`<section class="alerts">
            <h2>Alerts</h2>
            <ul>
              ${alerts.map(
                ({ text, startedAt }) => html`<li>${text} <span class="muted">since ${localTime(startedAt)}</span></li>`
              )}
            </ul>
          </section>`
        : ''}
      <section>
        <dl>
          <dt>Daemon</dt>
          <dd><strong class="up">Up</strong> since ${localTime(startedAt)}</dd>
        </dl>
        <form method="post" action="/actions/restart">
          <button ${canRestart ? '' : 'disabled'}>Restart</button>
        </form>
        ${canRestart ? '' : html`<p class="muted">${RESTART_NEEDS_PM2}</p>`}
      </section>
      <section>
        <h2>Recent Runs</h2>
        ${runList(recentRuns)}
        <p><a href="/runs">All Runs</a></p>
        <form method="post" action="/actions/run-now">
          <button>Run now</button>
        </form>
      </section>
      <section>
        <h2>Next up</h2>
        <dl>
          ${nextUp.map(
            ({ name, due }) => html`<dt>${name}</dt>
              <dd>${localTime(due)} <span class="muted">${timeUntil(now, due)}</span></dd>`
          )}
        </dl>
      </section>
      <p class="muted">Times are local to the daemon's machine (${Intl.DateTimeFormat().resolvedOptions().timeZone}).</p>
    `
  );
}

/** Every Run, newest first. */
export function runsPage(runs: RunRecord[]): Html {
  return layout(
    'Runs',
    html`<section>
      <h2>Runs</h2>
      ${runList(runs)}
    </section>`
  );
}

export interface RunPage {
  run: RunRecord;
  /** The Run's output folder, from the project root. */
  folder?: string;
  /** The spend recorded against the Run. */
  cost: string;
  /** The Run's log, when one was kept. */
  log?: string;
}

/** One Run: why it failed first, when it did, then what it made and its log. */
export function runPage({ run, folder, cost, log }: RunPage): Html {
  return layout(
    run.title ?? 'Run',
    html`
      ${run.outcome === 'failed' ? failure(run) : ''}
      <section>
        <h2>${run.title ?? 'Run'}</h2>
        <dl>
          <dt>Outcome</dt>
          <dd>${outcome(run)}</dd>
          ${run.genre ? html`<dt>Genre</dt><dd>${genre(run.genre)}</dd>` : ''}
          ${run.durationSec !== undefined ? html`<dt>Length</dt><dd>${seconds(run.durationSec)}</dd>` : ''}
          <dt>Started</dt>
          <dd>${localTime(run.startedAt)} by ${STARTED_BY[run.trigger]}</dd>
          ${run.finishedAt ? html`<dt>Finished</dt><dd>${localTime(run.finishedAt)}</dd>` : ''}
          <dt>Cost</dt>
          <dd>${cost}</dd>
          ${folder ? html`<dt>Folder</dt><dd>${folder}</dd>` : ''}
        </dl>
      </section>
      <section>
        <h2>Run log</h2>
        ${log !== undefined ? html`<pre>${log}</pre>` : html`<p>No run log was kept.</p>`}
      </section>
    `
  );
}

/** "Failed at step 5 of 7: over budget", then the error; in amber for a Daily budget stop. */
function failure(run: RunRecord): Html {
  const at = run.step ? ` at step ${run.step} of 7` : '';
  const reason = run.reason ? `: ${run.reason}` : '';
  return html`<section class="failure ${run.reason === 'over budget' ? 'amber' : 'failed'}">
    <h2>Failed${at}${reason}</h2>
    ${run.error ? html`<pre>${run.error}</pre>` : ''}
  </section>`;
}

/** One line per Run, linking to its page. */
function runList(runs: RunRecord[]): Html {
  if (runs.length === 0) return html`<p>No Runs yet.</p>`;
  return html`<ul class="runs">
    ${runs.map(
      (run) => html`<li><a href="/runs/${run.id}">${localTime(run.startedAt)}</a> ${outcome(run)} ${runSummary(run)}</li>`
    )}
  </ul>`;
}

/** "true_heists_cons · They beat the vault · 42 s · $0.12", leaving out what the Run doesn't have yet. */
function runSummary(run: RunRecord): Html {
  const parts = [
    run.genre && genre(run.genre),
    run.title,
    run.durationSec !== undefined && seconds(run.durationSec),
    `$${run.costUsd.toFixed(2)}`,
  ].filter((part) => part);
  return html`${parts.map((part, i) => html`${i ? ' · ' : ''}${part}`)}`;
}

/** "42 s", kept on one line. */
function seconds(durationSec: number): string {
  return `${Math.round(durationSec)}\u00a0s`;
}

/** A Run's outcome, coloured: a Daily budget stop in amber, apart from other failures. */
function outcome(run: RunRecord): Html {
  const [text, tone] = outcomeLabel(run);
  return html`<strong class="${tone}">${text}</strong>`;
}

/** What a Run's outcome says, and the class that colours it. */
function outcomeLabel(run: RunRecord): [string, string] {
  switch (run.outcome) {
    case 'in_progress':
      return ['in progress', 'muted'];
    case 'storyboard_only':
      return ['storyboard only', ''];
    case 'rendered':
      return ['rendered', 'up'];
    case 'failed':
      if (run.reason === 'over budget') return ['failed: over budget', 'amber'];
      if (run.reason) return [`failed: ${run.reason}`, 'failed'];
      return [run.step ? `failed at step ${run.step}` : 'failed', 'failed'];
  }
}

export interface StrategyPage {
  /** The strategy file's path from the project root. */
  strategyFile: string;
  /** What the strategy file holds, or why it can't be read. */
  strategy: StrategyRules | { error: string };
  /** Every evolve that changed the strategy, newest first. */
  evolves: RecordedEvolve[];
}

/** The current strategy and how evolve changed it, read-only: weights and rules are edited by hand. */
export function strategyPage({ strategyFile, strategy, evolves }: StrategyPage): Html {
  return layout(
    'Strategy',
    html`
      ${'error' in strategy
        ? html`<section>
            <h2>Current strategy</h2>
            <p>The strategy file ${strategyFile} can't be read: ${strategy.error}</p>
          </section>`
        : currentStrategy(strategy)}
      <section>
        <h2>Evolves</h2>
        ${evolves.length > 0
          ? evolves.map(
              ({ from, to, criticSummary, at }) => html`<article>
                <h3>Version ${to.version}</h3>
                <p class="muted">
                  ${from
                    ? html`Evolved from version ${from.version} on ${localTime(at)}`
                    : html`Evolved on ${localTime(at)}; the version before wasn't recorded`}
                </p>
                <p>${criticSummary}</p>
                <h4>Genre weights</h4>
                ${weightChanges(from?.nicheWeights, to.nicheWeights, genre)}
                <h4>Hook weights</h4>
                ${weightChanges(from?.hookArchetypeWeights, to.hookArchetypeWeights)}
              </article>`
            )
          : html`<p>No evolve has changed the strategy yet.</p>`}
      </section>
    `
  );
}

function currentStrategy(strategy: StrategyRules): Html {
  const { min, max } = strategy.targetDurationSeconds;
  return html`<section>
      <h2>Current strategy</h2>
      <dl>
        <dt>Version</dt>
        <dd>${strategy.version}</dd>
        <dt>Exploration rate</dt>
        <dd>${percent(strategy.explorationRate)}</dd>
        <dt>Target length</dt>
        <dd>${min}–${max} s</dd>
      </dl>
    </section>
    <section>
      <h2>Genre weights</h2>
      ${weights(strategy.nicheWeights, genre)}
    </section>
    <section>
      <h2>Hook weights</h2>
      ${weights(strategy.hookArchetypeWeights)}
    </section>
    <section>
      <h2>Rules</h2>
      <h3>Do</h3>
      <ul>
        ${strategy.doRules.map((rule) => html`<li>${rule}</li>`)}
      </ul>
      <h3>Don't</h3>
      <ul>
        ${strategy.dontRules.map((rule) => html`<li>${rule}</li>`)}
      </ul>
    </section>
    <section>
      <h2>Voices</h2>
      <dl>
        ${Object.entries(strategy.voicePool).map(
          ([gender, voices]) => html`<dt>${capitalize(gender)}</dt><dd>${voices.join(', ')}</dd>`
        )}
        <dt>Speed</dt>
        <dd>${strategy.voiceSpeedRate}</dd>
      </dl>
    </section>`;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

type Label = (name: string) => Html | string;

function weights(byName: Record<string, number>, label?: Label): Html {
  return weightList(Object.keys(byName), (name) => percent(byName[name]), label);
}

/**
 * Each weight before and after, by name; a weight missing on one side counts as 0. With nothing
 * before, just the weights after.
 */
function weightChanges(before: Record<string, number> | undefined, after: Record<string, number>, label?: Label): Html {
  if (!before) return weights(after, label);
  const names = [...new Set([...Object.keys(after), ...Object.keys(before)])];
  return weightList(names, (name) => weightChange(before[name] ?? 0, after[name] ?? 0), label);
}

/** One line per weight: its name, then what `show` says about it. */
function weightList(names: string[], show: (name: string) => Html | string, label: Label = (name) => name): Html {
  return html`<dl>
    ${names.map((name) => html`<dt>${label(name)}</dt><dd>${show(name)}</dd>`)}
  </dl>`;
}

/** "8% → 10.5% +2.5 pts", or "10% no change". */
function weightChange(before: number, after: number): Html {
  const points = (hundredthsOfAPercent(after) - hundredthsOfAPercent(before)) / 100;
  if (points === 0) return html`${percent(after)} <span class="muted">no change</span>`;
  const size = Math.abs(points);
  return html`${percent(before)} → ${percent(after)} <strong>${points > 0 ? '+' : '−'}${size} ${size === 1 ? 'pt' : 'pts'}</strong>`;
}

/** A Genre's name, labelled retired once it is no longer in the Genre list. */
function genre(name: string): Html {
  return html`${name}${name in GENRES ? '' : html` <span class="tag">retired</span>`}`;
}

/** 0.14 as "14%", 0.0812 as "8.12%". */
function percent(weight: number): string {
  return `${hundredthsOfAPercent(weight) / 100}%`;
}

/**
 * A weight in whole hundredths of a percent, the precision the page shows, so changes add up
 * exactly and evolve's small changes still show.
 */
function hundredthsOfAPercent(weight: number): number {
  return Math.round(weight * 10_000);
}

/** Why Restart is off when the daemon wasn't started by pm2. */
export const RESTART_NEEDS_PM2 =
  "Restart is off: pm2 isn't running the daemon, so nothing would start it again. " +
  'Start it with "pm2 start ecosystem.config.cjs" (see docs/DAEMON_SETUP.md).';

/**
 * Shown while pm2 restarts the daemon; goes back to the front page once it should be up again. Its
 * address becomes the front page's at once, so reloading it doesn't post the restart again.
 */
export function restartingPage(): Html {
  return layout(
    'Restarting',
    html`<section>
      <h2>Restarting</h2>
      <p>The daemon is stopping, and pm2 will start it again. This page goes back to the dashboard in a few seconds.</p>
    </section>`,
    html`<meta http-equiv="refresh" content="5; url=/" />
      <script>
        history.replaceState(null, '', '/');
      </script>`
  );
}

function layout(title: string, body: Html, head: Html | '' = ''): Html {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        ${head}
        <title>${title} · Faceless Video Pipeline</title>
        <style>
          ${raw(CSS)}
        </style>
      </head>
      <body>
        <main>
          <h1>Faceless Video Pipeline</h1>
          <nav>
            <a href="/">Dashboard</a>
            <a href="/runs">Runs</a>
            <a href="/strategy">Strategy</a>
          </nav>
          ${body}
        </main>
      </body>
    </html>`;
}

// One column at any width; long words wrap instead of pushing the page sideways.
const CSS = `
  :root { color-scheme: light dark; --bg: #fff; --fg: #1b1b1b; --muted: #666; --line: #ddd; --ok: #1a7f37; --alert: #b42318; --amber: #b54708; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #131313; --fg: #ececec; --muted: #9b9b9b; --line: #333; --ok: #3fb950; --alert: #f85149; --amber: #f5a524; }
  }
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; overflow-wrap: anywhere; }
  main { max-width: 40rem; margin: 0 auto; padding: 1rem; }
  h1 { font-size: 1.3rem; margin: 0 0 0.25rem; }
  nav { display: flex; flex-wrap: wrap; gap: 0 1.25rem; margin-bottom: 0.75rem; }
  nav a { color: inherit; padding: 0.5rem 0; }
  h2 { font-size: 1.05rem; margin: 0 0 0.5rem; }
  h3 { font-size: 1rem; margin: 0.75rem 0 0.25rem; }
  h4 { font-size: 0.95rem; margin: 0.75rem 0 0.25rem; color: var(--muted); }
  article + article { border-top: 1px solid var(--line); margin-top: 1rem; }
  section { border: 1px solid var(--line); border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1rem; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; margin: 0; }
  dt { color: var(--muted); }
  dd { margin: 0; }
  ul { margin: 0; padding-left: 1.25rem; }
  .alerts { border-color: var(--alert); }
  .alerts h2 { color: var(--alert); }
  form { margin: 0.75rem 0 0; }
  button { font: inherit; min-height: 2.75rem; padding: 0.5rem 1.25rem; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .up { color: var(--ok); }
  .failed { color: var(--alert); }
  .amber { color: var(--amber); }
  .failure { border-color: currentColor; }
  .failure pre { color: var(--fg); }
  pre { margin: 0.5rem 0 0; font-size: 0.8rem; white-space: pre-wrap; overflow-wrap: anywhere; }
  .runs { list-style: none; padding: 0; }
  .runs li + li { border-top: 1px solid var(--line); margin-top: 0.4rem; padding-top: 0.4rem; }
  .muted { color: var(--muted); }
  .tag { font-size: 0.8em; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 0 0.3em; }
  section p { margin: 0.5rem 0 0; }
`;

/** A time on the page, written as `formatLocalTime` writes it. */
function localTime(at: Date): Html {
  return html`<time datetime="${at.toISOString()}">${formatLocalTime(at)}</time>`;
}

/** "in 2 d 6 h", "in 3 h 20 min", "in 5 min". */
function timeUntil(from: Date, to: Date): string {
  const minutes = Math.max(0, Math.ceil((to.getTime() - from.getTime()) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `in ${days} d${hours ? ` ${hours} h` : ''}`;
  if (hours > 0) return `in ${hours} h${mins ? ` ${mins} min` : ''}`;
  return `in ${mins} min`;
}
