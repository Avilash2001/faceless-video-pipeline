import { html, raw } from 'hono/html';

type Html = ReturnType<typeof html>;

export interface FrontPage {
  now: Date;
  startedAt: Date;
  /** Each scheduled task and when it next comes due. */
  nextUp: { name: string; due: Date }[];
}

export function frontPage({ now, startedAt, nextUp }: FrontPage): Html {
  return layout(
    'Dashboard',
    html`
      <section>
        <dl>
          <dt>Daemon</dt>
          <dd><strong class="up">Up</strong> since ${localTime(startedAt)}</dd>
        </dl>
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

function layout(title: string, body: Html): Html {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
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
  :root { color-scheme: light dark; --bg: #fff; --fg: #1b1b1b; --muted: #666; --line: #ddd; --ok: #1a7f37; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #131313; --fg: #ececec; --muted: #9b9b9b; --line: #333; --ok: #3fb950; }
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
  .up { color: var(--ok); }
  .muted { color: var(--muted); }
`;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sun 25 Oct 18:00", in the machine's local time. */
function localTime(at: Date): Html {
  const pad = (n: number) => String(n).padStart(2, '0');
  const text = `${WEEKDAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return html`<time datetime="${at.toISOString()}">${text}</time>`;
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
