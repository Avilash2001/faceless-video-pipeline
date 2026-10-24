import fs from 'fs';
import os from 'os';
import path from 'path';
import { onTestFinished } from 'vitest';
import type { AlertRule } from '../../src/daemon/alerts.js';
import { createDaemon } from '../../src/daemon/index.js';
import { loadConfig } from '../../src/loadConfig.js';
import type { RunOptions } from '../../src/types.js';
import { fakeAdapters } from './fakeAdapters.js';
import { FakeClock } from './fakeClock.js';

const DASHBOARD = 'localhost:4747';

/**
 * Starts a Daemon on a fake clock, with its database and folders in a fresh temp directory and
 * fake adapters, and tears it all down when the test finishes. `env` is written to `.env` and
 * the config is built from it; `envExample`, when given, is written to `.env.example`.
 * `slotOptions` stands in for the flags `pnpm daemon` was started with, and `alertRules` are
 * checked along with the Daemon's own. The Daemon runs under pm2 unless `underPm2` is false.
 */
export function startTestDaemon(opts: {
  now: Date;
  env?: Record<string, string>;
  envExample?: string;
  slotOptions?: RunOptions;
  alertRules?: AlertRule[];
  underPm2?: boolean;
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
  const clock = new FakeClock(opts.now);
  const { adapters, calls, failures, pipelineSpend } = fakeAdapters(clock, config, { underPm2: opts.underPm2 });
  const startDaemon = (env: Record<string, string>) => {
    const started = createDaemon(loadConfig(env, root), adapters, {
      slotOptions: opts.slotOptions,
      alertRules: opts.alertRules,
    });
    started.start();
    stopDaemon = () => started.stop();
    return started;
  };
  let daemon = startDaemon(opts.env ?? {});

  /** Sends a request in-process, as a browser on the dashboard's own page would by default. */
  const request = (pathname: string, init: { method?: string; headers?: Record<string, string> } = {}) => {
    const headers = { host: DASHBOARD, ...init.headers };
    return daemon.app.request(`http://${headers.host}${pathname}`, { method: init.method, headers });
  };
  /** Posts an action, as a form on the dashboard's own page does. */
  const post = (pathname: string) =>
    request(pathname, { method: 'POST', headers: { origin: `http://${DASHBOARD}` } });

  return {
    /** The dashboard's routes; add one only before the first request. */
    app: daemon.app,
    clock,
    calls,
    /** Makes one Run straight away, as `pnpm generate` does. */
    generate: (options: RunOptions) => daemon.generate(options),
    failures,
    pipelineSpend,
    post,
    request,
    writeEnv,
    /** Stops the Daemon and starts a new one on the same folders, clock and fakes, with `env` as its `.env`. */
    async restart(env: Record<string, string>) {
      await stopDaemon();
      writeEnv(env);
      daemon = startDaemon(env);
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
  };
}

function visibleText(html: string): string {
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
