import { serve, type ServerType } from '@hono/node-server';
import fs from 'fs';
import { Hono } from 'hono';
import type { AddressInfo } from 'net';
import path from 'path';
import { openDatabase } from '../db/open.js';
import { getRun, interruptRuns, listRuns, type RunRecord, type RunTrigger } from '../db/runs.js';
import { evolveHistory } from '../db/strategyHistory.js';
import type { Config } from '../loadConfig.js';
import type { Platform, PublishResult, VideoToPublish } from '../platforms.js';
import { formatCost } from '../spend.js';
import type { PipelineResult, Push, RunOptions, RunProgress, StrategyRules } from '../types.js';
import { createAlerts, type AlertRule } from './alerts.js';
import { every, type Clock } from './clock.js';
import { startRun as beginRun, RunInProgressError, type StartedRun } from './generate.js';
import { missingEnvKeysRule } from './missingEnvKeys.js';
import {
  frontPage,
  RESTART_NEEDS_PM2,
  restartingPage,
  runPage,
  runsPage,
  strategyPage,
  type StrategyPage,
} from './pages.js';
import { protect } from './protect.js';
import { nextDue, startSchedule, type ScheduledTask } from './schedule.js';

const ALERT_CHECK_EVERY_MS = 60_000;
const HEARTBEAT_EVERY_MS = 5 * 60_000;
/** How many Runs the front page lists. */
const RECENT_RUNS = 5;

/** Everything the Daemon reaches outside the process through. Tests pass fakes. */
export interface Adapters {
  clock: Clock;
  /** Finds a Story and takes it through to a rendered Video: steps 1 to 6 of a Run. */
  pipeline: { run(options: RunOptions, progress: RunProgress): Promise<PipelineResult> };
  /** Publishes one Video to one Platform, returning how it went rather than throwing. */
  platforms: { publish(platform: Platform, video: VideoToPublish): Promise<PublishResult> };
  /** The learning loop: pulls Post metrics, and evolves the strategy from them. */
  analytics: { syncMetrics(): Promise<void>; evolve(): Promise<void> };
  /** Pushes to the operator's phone through ntfy. Throws when the push didn't go out. */
  notifier: { send(push: Push): Promise<void> };
  /** Pings the heartbeat service (healthchecks.io), which pushes when the pings stop. */
  heartbeat: { ping(url: string): Promise<void> };
  /** pm2, which keeps the daemon running and starts it again whenever it exits. */
  processControl: {
    /** Whether exiting would bring the daemon back: only when pm2 runs this process. */
    canRestart(): boolean;
    /** Exits, for pm2 to start the daemon again. Called once the Daemon has stopped. */
    restart(): void;
  };
}

export interface Daemon {
  /** The dashboard: served by `listen`, or called in-process by tests. */
  app: Hono;
  /**
   * Starts the generate, metrics sync and evolve schedules, the Alert checks and the heartbeat. A
   * Run still marked in progress was cut off when the daemon last stopped, so it is marked failed.
   */
  start(): void;
  /** Serves the dashboard on 127.0.0.1 only, at DASHBOARD_PORT. */
  listen(): Promise<AddressInfo>;
  /**
   * Makes one Run with these options, as a Slot would: how the command line starts a Run. Rejects
   * with RunInProgressError, naming that Run, while another Run is in progress.
   */
  generate(options: RunOptions): Promise<void>;
  /** Pulls Post metrics now, as the metrics sync schedule does: how the command line syncs. */
  syncMetrics(): Promise<void>;
  /** Evolves the strategy now, as the evolve schedule does: how the command line evolves. */
  evolve(): Promise<void>;
  /**
   * Marks the Run this Daemon started as failed (interrupted), if it is still in progress: for when
   * the process is stopped part-way through it. Runs started by other processes are left alone.
   */
  interrupt(): void;
  stop(): Promise<void>;
}

export interface DaemonOptions {
  /** Given to every Slot's Run: the flags `pnpm daemon` was started with. */
  slotOptions?: RunOptions;
  /** Checked along with the Daemon's own Alert rules; tests use them to stand in for any rule. */
  alertRules?: AlertRule[];
}

/**
 * Builds the daemon: the schedule, the Alert checks and the dashboard, in one process (ADR 0001).
 * Alert rules are checked every minute and after each Run.
 */
export function createDaemon(config: Config, adapters: Adapters, options: DaemonOptions = {}): Daemon {
  const { slotOptions = {} } = options;
  const { clock } = adapters;
  const database = openDatabase(config.paths.dbFile);
  const startedAt = clock.now();
  const deps = { ...adapters, config, database };
  const alertRules = [missingEnvKeysRule(config.paths.root), ...(options.alertRules ?? [])];
  const alerts = createAlerts({ ...adapters, database, settings: config.alerts, rules: alertRules });
  const syncMetrics = () => adapters.analytics.syncMetrics();
  const evolve = () => adapters.analytics.evolve();
  /** The latest Run this Daemon started. */
  let ownRun: string | undefined;
  /** Starts a Run, or throws RunInProgressError while one is in progress. Alerts are checked once it ends. */
  const startRun = (trigger: RunTrigger, options: RunOptions): StartedRun => {
    const run = beginRun(deps, trigger, options);
    ownRun = run.id;
    return { id: run.id, done: run.done.finally(() => alerts.check()) };
  };
  const tasks: ScheduledTask[] = [
    { name: 'Generate', expression: config.schedule.generate, run: () => startRun('slot', slotOptions).done },
    { name: 'Metrics sync', expression: config.schedule.metrics, run: () => syncMetrics() },
    { name: 'Evolve', expression: config.schedule.evolve, run: () => evolve() },
  ];

  const app = new Hono();
  app.use(protect(config.dashboard.allowedHosts));
  app.get('/', (c) => {
    const now = clock.now();
    const nextUp = tasks.map((task) => ({ name: task.name, due: nextDue(task.expression, now) }));
    const canRestart = adapters.processControl.canRestart();
    const recentRuns = listRuns(database, RECENT_RUNS);
    return c.html(frontPage({ now, startedAt, nextUp, alerts: alerts.active(), canRestart, recentRuns }));
  });
  app.get('/runs', (c) => c.html(runsPage(listRuns(database))));
  app.get('/runs/:id', (c) => {
    const run = getRun(database, c.req.param('id'));
    if (!run) return c.notFound();
    return c.html(
      runPage({
        run,
        folder: run.folder && path.relative(config.paths.root, run.folder),
        cost: formatCost(run.costUsd, config.costs),
        log: readRunLog(run),
      })
    );
  });
  app.get('/strategy', (c) => {
    const { root, strategyFile } = config.paths;
    return c.html(
      strategyPage({
        strategyFile: path.relative(root, strategyFile),
        strategy: readStrategy(strategyFile),
        evolves: evolveHistory(database),
      })
    );
  });
  app.post('/actions/run-now', (c) => {
    let run: StartedRun;
    try {
      run = startRun('run_now', {});
    } catch (err) {
      if (err instanceof RunInProgressError) return c.text(err.message, 409);
      throw err;
    }
    // The Run goes on after the answer; its page shows how it ends.
    run.done.catch((err) => console.error(`[Daemon] Run now failed: ${(err as Error).message || String(err)}`));
    return c.redirect(`/runs/${run.id}`, 303);
  });
  app.post('/actions/restart', (c) => {
    if (!adapters.processControl.canRestart()) return c.text(RESTART_NEEDS_PM2, 409);
    console.log('[Daemon] Restart asked from the dashboard: stopping, for pm2 to start it again.');
    // Answer first; the Daemon stops and exits on the clock's next turn. It exits even if
    // stopping failed, so pm2 still brings it back.
    clock.setTimeout(() => {
      stop()
        .catch((err) => console.error(`[Daemon] Stopping failed: ${(err as Error).message || String(err)}`))
        .then(() => adapters.processControl.restart());
    }, 0);
    return c.html(restartingPage());
  });

  let stopSchedule = () => {};
  let stopAlertChecks = () => {};
  let stopHeartbeat = () => {};
  let server: ServerType | undefined;
  let stopped: Promise<void> | undefined;

  /** Stops everything the Daemon started; stopping again waits for the first stop. */
  function stop(): Promise<void> {
    stopped ??= (async () => {
      stopSchedule();
      stopAlertChecks();
      stopHeartbeat();
      await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
      await alerts.idle();
      database.close();
    })();
    return stopped;
  }

  return {
    app,
    start() {
      const interrupted = interruptRuns(database, clock.now());
      if (interrupted) console.warn(`[Daemon] Marked ${interrupted} Run(s) left in progress as failed (interrupted).`);
      stopSchedule = startSchedule(clock, tasks);
      stopAlertChecks = every(clock, ALERT_CHECK_EVERY_MS, () => alerts.check());
      const { url } = config.heartbeat;
      if (url) {
        stopHeartbeat = every(clock, HEARTBEAT_EVERY_MS, () =>
          adapters.heartbeat
            .ping(url)
            .catch((err) => console.warn(`[Heartbeat] Ping failed: ${(err as Error).message || String(err)}`))
        );
      }
    },
    listen() {
      return new Promise((resolve) => {
        server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: config.dashboard.port }, resolve);
      });
    },
    async generate(options) {
      await startRun('command_line', options).done;
    },
    syncMetrics,
    evolve,
    interrupt() {
      if (ownRun && interruptRuns(database, clock.now(), ownRun)) {
        console.warn(`[Daemon] Stopped part-way through Run ${ownRun}: marked it failed (interrupted).`);
      }
    },
    stop,
  };
}

/** The Run's log: run.log in its folder, or the log kept with its record when it ended before it had one. */
function readRunLog(run: RunRecord): string | undefined {
  if (!run.folder) return run.log;
  try {
    return fs.readFileSync(path.join(run.folder, 'run.log'), 'utf-8');
  } catch {
    return undefined;
  }
}

/** The strategy evolve and the Pipeline read, or why it can't be read. */
function readStrategy(file: string): StrategyPage['strategy'] {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as StrategyRules;
  } catch (err) {
    return { error: (err as Error).message || String(err) };
  }
}
