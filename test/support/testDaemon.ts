import fs from 'fs';
import os from 'os';
import path from 'path';
import { onTestFinished } from 'vitest';
import type { AlertRule } from '../../src/daemon/alerts.js';
import { createDaemon } from '../../src/daemon/index.js';
import { openDatabase } from '../../src/db/open.js';
import { recordEvolve } from '../../src/db/strategyHistory.js';
import { loadConfig } from '../../src/loadConfig.js';
import type { RunOptions, StrategyRules } from '../../src/types.js';
import { fakeAdapters } from './fakeAdapters.js';
import { FakeClock } from './fakeClock.js';

const DASHBOARD = 'localhost:4747';

/**
 * Starts a Daemon on a fake clock, with its database and folders in a fresh temp directory and
 * fake adapters, and tears it all down when the test finishes. `env` is written to `.env` and
 * the config is built from it; `envExample`, when given, is written to `.env.example`.
 * `slotOptions` stands in for the flags `pnpm daemon` was started with, and `alertRules` are
 * checked along with the Daemon's own. The Daemon runs under pm2 unless `underPm2` is false.
 * `strategy`, when given, is written to the strategy file.
 */
export function startTestDaemon(opts: {
  now: Date;
  env?: Record<string, string>;
  envExample?: string;
  slotOptions?: RunOptions;
  alertRules?: AlertRule[];
  underPm2?: boolean;
  strategy?: StrategyRules;
}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fvp-daemon-'));
  let stopDaemon = async () => {};
  onTestFinished(async () => {
    await stopDaemon();
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** Rewrites `.env`, as the operator does by hand. The running config doesn't change. */
  const writeEnv = (env: Record<string, string>) =>
    fs.writeFileSync(
      path.join(root, '.env'),
      Object.entries(env)
        .map(([key, value]) => `${key}=${value}\n`)
        .join('')
    );
  writeEnv(opts.env ?? {});
  if (opts.envExample !== undefined) fs.writeFileSync(path.join(root, '.env.example'), opts.envExample);

  const config = loadConfig(opts.env ?? {}, root);
  const writeStrategy = (strategy: StrategyRules) => {
    fs.mkdirSync(path.dirname(config.paths.strategyFile), { recursive: true });
    fs.writeFileSync(config.paths.strategyFile, JSON.stringify(strategy, null, 2));
  };
  if (opts.strategy) writeStrategy(opts.strategy);
  const clock = new FakeClock(opts.now);
  const { adapters, calls, failures, holdPipeline, pipelineSpend } = fakeAdapters(clock, config, {
    underPm2: opts.underPm2,
  });
  const startDaemon = (env: Record<string, string>) => {
    const started = createDaemon(loadConfig(env, root), adapters, {
      slotOptions: opts.slotOptions,
      alertRules: opts.alertRules,
    });
    started.start();
    stopDaemon = () => started.stop();
    return started;
  };
  let env = opts.env ?? {};
  let daemon = startDaemon(env);
  /** The Daemon `pnpm generate` builds: its own, on the same folders, never started. */
  const commandLine = () => createDaemon(loadConfig(env, root), adapters, { alertRules: opts.alertRules });

  /** Sends a request in-process, as a browser on the dashboard's own page would by default. */
  const request = (
    pathname: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {}
  ) => {
    const headers = { host: DASHBOARD, ...init.headers };
    return daemon.app.request(`http://${headers.host}${pathname}`, { method: init.method, headers, body: init.body });
  };
  /** Posts an action, as a form on the dashboard's own page does, with `form` as the form's fields. */
  const post = (pathname: string, form: Record<string, string> = {}) =>
    request(pathname, {
      method: 'POST',
      headers: { origin: `http://${DASHBOARD}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });

  return {
    /** The dashboard's routes; add one only before the first request. */
    app: daemon.app,
    clock,
    calls,
    /**
     * Makes one Run straight away, as `pnpm generate` does: through a Daemon of its own on the same
     * folders, never started, which shares only the database with the running one.
     */
    async generate(options: RunOptions) {
      const cli = commandLine();
      try {
        await cli.generate(options);
      } finally {
        await cli.stop();
      }
    },
    /**
     * Starts `pnpm generate` (see `generate`) without waiting for it to finish, and resolves once
     * its Run has got as far as it can. `done` is how the process ends if nothing stops it;
     * `stopWithSignal` is Ctrl-C or SIGTERM, which interrupts the Run, and the process is gone.
     */
    async startGenerate(options: RunOptions) {
      const cli = commandLine();
      const done = cli.generate(options);
      // Handled here, so a refusal while starting isn't reported before the test awaits `done`.
      done.catch(() => {});
      await new Promise<void>((resolve) => setImmediate(resolve));
      return {
        done,
        async stopWithSignal() {
          cli.interrupt();
          await cli.stop();
        },
      };
    },
    failures,
    holdPipeline,
    pipelineSpend,
    post,
    request,
    /** Lets work already under way, such as the Run a Run now started, go as far as it can. */
    settle,
    writeEnv,
    /** Stops the Daemon and starts a new one on the same folders, clock and fakes, with `env` as its `.env`. */
    async restart(newEnv: Record<string, string>) {
      await stopDaemon();
      env = newEnv;
      writeEnv(env);
      daemon = startDaemon(env);
    },
    /**
     * Does what evolve does once Gemini has answered: writes `strategy` to the strategy file and
     * records it as an evolve, at `at`, from the strategy that was there.
     */
    recordEvolve(strategy: StrategyRules, criticSummary: string, at: Date) {
      const from = JSON.parse(fs.readFileSync(config.paths.strategyFile, 'utf-8')) as StrategyRules;
      writeStrategy(strategy);
      const database = openDatabase(config.paths.dbFile);
      try {
        recordEvolve(database, { from, to: strategy, criticSummary, at });
      } finally {
        database.close();
      }
    },
    /** The run.log in each Run's folder, oldest Run first. */
    runLogs(): string[] {
      const { outputDir } = config.paths;
      if (!fs.existsSync(outputDir)) return [];
      return fs
        .readdirSync(outputDir)
        .sort()
        .map((run) => fs.readFileSync(path.join(outputDir, run, 'run.log'), 'utf-8'));
    },
    /** The page's visible text, with tags stripped and whitespace collapsed. */
    async pageText(pathname: string) {
      const res = await request(pathname);
      if (res.status !== 200) throw new Error(`GET ${pathname} answered ${res.status}`);
      return visibleText(await res.text());
    },
    /**
     * Opens the dashboard's event stream, as a page does, and collects each event it sends. The
     * stream is closed when the test finishes.
     */
    async openEvents() {
      const res = await request('/events');
      if (res.status !== 200 || !res.body) throw new Error(`GET /events answered ${res.status}`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      onTestFinished(() => reader.cancel());
      const events: StreamEvent[] = [];
      let ended = false;
      let buffer = '';
      void (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += value;
          for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
            events.push(parseEvent(buffer.slice(0, end)));
            buffer = buffer.slice(end + 2);
          }
        }
        ended = true;
      })();
      return {
        contentType: res.headers.get('content-type'),
        /** Every event sent so far, once the work under way has gone as far as it can. */
        async received(): Promise<StreamEvent[]> {
          await settle();
          return events;
        },
        /** Whether the dashboard has ended the stream. */
        async ended(): Promise<boolean> {
          await settle();
          return ended;
        },
      };
    },
  };
}

/** One event from the dashboard's event stream: its type and its data, parsed. */
export interface StreamEvent {
  event: string;
  data: unknown;
}

/** "event: step\ndata: {...}" → { event: 'step', data: {...} }. */
function parseEvent(text: string): StreamEvent {
  const lines = text.split('\n');
  const event = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length) ?? 'message';
  const data = lines
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length))
    .join('\n');
  return { event, data: JSON.parse(data) };
}

/** Lets work already under way go as far as it can. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Text a browser would show for `html`, with tags stripped and whitespace collapsed. */
export function visibleText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
