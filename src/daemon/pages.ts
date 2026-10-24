import { html, raw } from 'hono/html';
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
}

export function frontPage({ now, startedAt, nextUp, alerts, canRestart }: FrontPage): Html {
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
          ${body}
        </main>
      </body>
    </html>`;
}

// One column at any width; long words wrap instead of pushing the page sideways.
const CSS = `
  :root { color-scheme: light dark; --bg: #fff; --fg: #1b1b1b; --muted: #666; --line: #ddd; --ok: #1a7f37; --alert: #b42318; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #131313; --fg: #ececec; --muted: #9b9b9b; --line: #333; --ok: #3fb950; --alert: #f85149; }
  }
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; overflow-wrap: anywhere; }
  main { max-width: 40rem; margin: 0 auto; padding: 1rem; }
  h1 { font-size: 1.3rem; margin: 0 0 1rem; }
  h2 { font-size: 1.05rem; margin: 0 0 0.5rem; }
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
  .muted { color: var(--muted); }
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
