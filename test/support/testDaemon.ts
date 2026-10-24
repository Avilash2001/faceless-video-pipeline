import fs from 'fs';
import os from 'os';
import path from 'path';
import { onTestFinished } from 'vitest';
import { createDaemon } from '../../src/daemon/index.js';
import { loadConfig } from '../../src/loadConfig.js';
import type { RunOptions } from '../../src/types.js';
import { fakeAdapters } from './fakeAdapters.js';
import { FakeClock } from './fakeClock.js';

const DASHBOARD = 'localhost:4747';

/**
 * Starts a Daemon on a fake clock, with its database and folders in a fresh temp directory and
 * fake adapters, and tears it all down when the test finishes. `env` stands in for `.env`, and
 * `slotOptions` for the flags `pnpm daemon` was started with.
 */
export function startTestDaemon(opts: { now: Date; env?: Record<string, string>; slotOptions?: RunOptions }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fvp-daemon-'));
  const config = loadConfig(opts.env ?? {}, root);
  const clock = new FakeClock(opts.now);
  const { adapters, calls, failures, pipelineSpend } = fakeAdapters(clock, config);
  const daemon = createDaemon(config, adapters, opts.slotOptions);
  daemon.start();
  onTestFinished(async () => {
    await daemon.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** Sends a request in-process, as a browser on the dashboard's own page would by default. */
  const request = (pathname: string, init: { method?: string; headers?: Record<string, string> } = {}) => {
    const headers = { host: DASHBOARD, ...init.headers };
    return daemon.app.request(`http://${headers.host}${pathname}`, { method: init.method, headers });
  };

  return {
    /** The dashboard's routes; add one only before the first request. */
    app: daemon.app,
    clock,
    calls,
    /** Makes one Run straight away, as `pnpm generate` does. */
    generate: daemon.generate,
    failures,
    pipelineSpend,
    request,
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
    .replace(/\s+/g, ' ')
    .trim();
}
