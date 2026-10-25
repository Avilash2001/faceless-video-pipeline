import { serve, type ServerType } from '@hono/node-server';
import fs from 'fs';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AddressInfo } from 'net';
import path from 'path';
import { openDatabase } from '../db/open.js';
import { getRun, interruptRuns, listRuns, runInProgress, type RunRecord, type RunTrigger } from '../db/runs.js';
import { evolveHistory } from '../db/strategyHistory.js';
import type { Config } from '../loadConfig.js';
import type { Platform, PublishResult, VideoToPublish } from '../platforms.js';
import { checkDailyBudget, formatCost } from '../spend.js';
import type { PipelineResult, Push, RunOptions, RunProgress, StrategyRules } from '../types.js';
import { createAlerts, type AlertRule } from './alerts.js';
import { every, type Clock } from './clock.js';
import { startRun as beginRun, RunInProgressError, type StartedRun } from './generate.js';
import { LiveProgress, RunFollower, type RunEvent } from './liveProgress.js';
import { missingEnvKeysRule } from './missingEnvKeys.js';
import {
  frontPage,
  overBudgetPage,
  RESTART_NEEDS_PM2,
  restartingPage,
  runPage,
  runsPage,
  strategyPage,
  type StrategyPage,
} from './pages.js';
import { protect } from './protect.js';
import { RUN_ANYWAY, runNowFields, runNowOptions, UnknownOptionError } from './runNow.js';
import { nextDue, startSchedule, type ScheduledTask } from './schedule.js';

const ALERT_CHECK_EVERY_MS = 60_000;
/** How often a Run another process started, such as a command-line Run, is caught up with while a page watches. */
const FOLLOW_EVERY_MS = 2_000;
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
  const live = new LiveProgress();
  const follower = new RunFollower(database, live);
  /** Catches up with a Run another process has in progress, such as a command-line Run. */
  const followRuns = () => {
    try {
      follower.check();
    } catch (err) {
      console.warn(`[Daemon] Couldn't catch up with the Run in progress: ${(err as Error).message || String(err)}`);
    }
  };
  let watchers = 0;
  let stopFollowing = () => {};
  /** Keeps following Runs other processes start, until the function it returns is called: while a page watches. */
  const watchRuns = (): (() => void) => {
    if (watchers++ === 0) stopFollowing = every(clock, FOLLOW_EVERY_MS, followRuns);
    return () => {
      if (--watchers === 0) stopFollowing();
    };
  };
  const deps = { ...adapters, config, database, watcher: live };
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
    followRuns();
    const now = clock.now();
    const nextUp = tasks.map((task) => ({ name: task.name, due: nextDue(task.expression, now) }));
    const canRestart = adapters.processControl.canRestart();
    const recentRuns = listRuns(database, RECENT_RUNS);
    const inProgress = runInProgress(database);
    const current = inProgress && { run: inProgress, live: live.of(inProgress.id) };
    const defaultProviders = { image: config.visuals.imageProvider, motion: config.visuals.motionProvider };
    return c.html(
      frontPage({ now, startedAt, nextUp, alerts: alerts.active(), canRestart, recentRuns, current, defaultProviders })
    );
  });
  // Which Run is in progress, then each step and log line of the Run in progress as it happens: at
  // once for this Daemon's Runs, and at each check for a Run another process started. A page joining
  // part-way through a Run first gets its step and its log so far.
  app.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      followRuns();
      // Taken together, before anything is sent, so the catching up and what follows neither miss nor repeat a line.
      const subscription = live.subscribe();
      const catchUp: RunEvent[] = [
        { event: 'run', data: { run: runInProgress(database)?.id ?? null } },
        ...live.catchUp(),
      ];
      const unwatch = watchRuns();
      stream.onAbort(() => subscription.close());
      const send = (event: RunEvent) => stream.writeSSE({ event: event.event, data: JSON.stringify(event.data) });
      try {
        for (const event of catchUp) await send(event);
        for (let event = await subscription.next(); event; event = await subscription.next()) await send(event);
      } finally {
        unwatch();
      }
    })
  );
  app.get('/runs', (c) => c.html(runsPage(listRuns(database))));
  app.get('/runs/:id', (c) => {
    followRuns();
    const run = getRun(database, c.req.param('id'));
    if (!run) return c.notFound();
    return c.html(
      runPage({
        run,
        folder: run.folder && path.relative(config.paths.root, run.folder),
        cost: formatCost(run.costUsd, config.costs),
        log: readRunLog(run),
        live: live.of(run.id),
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
  app.post('/actions/run-now', async (c) => {
    const form = await c.req.parseBody();
    let options: RunOptions;
    try {
      options = runNowOptions(form);
    } catch (err) {
      if (err instanceof UnknownOptionError) return c.text(err.message, 400);
      throw err;
    }
    const inProgress = runInProgress(database);
    if (inProgress) return c.text(new RunInProgressError(inProgress).message, 409);
    // Run now only warns when the Daily budget probably won't cover the Video; going ahead is up to you.
    const budget = checkDailyBudget(options, config, database);
    if (!budget.fits && !form[RUN_ANYWAY]) {
      const fields = { ...runNowFields(options), [RUN_ANYWAY]: 'on' };
      return c.html(overBudgetPage({ budget, dailyBudgetUsd: config.costs.dailyBudgetUsd, fields }));
    }
    let run: StartedRun;
    try {
      run = startRun('run_now', options);
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
      live.close();
      stopFollowing();
      stopSchedule();
      stopAlertChecks();
      stopHeartbeat();
      await new Promise((resolve) => {
        if (!server) return resolve(undefined);
        server.close(resolve);
        // Browsers keep connections open between requests, and reconnect an open page's event
        // stream; either would hold the close up.
        if ('closeAllConnections' in server) server.closeAllConnections();
      });
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
