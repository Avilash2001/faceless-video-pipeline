import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import type { AddressInfo } from 'net';
import { openDatabase } from '../db/open.js';
import type { Config } from '../loadConfig.js';
import type { Platform, PublishResult, VideoToPublish } from '../platforms.js';
import type { PipelineResult, Push, RunOptions, RunProgress } from '../types.js';
import { createAlerts, type AlertRule } from './alerts.js';
import { every, type Clock } from './clock.js';
import { generate } from './generate.js';
import { missingEnvKeysRule } from './missingEnvKeys.js';
import { frontPage } from './pages.js';
import { protect } from './protect.js';
import { nextDue, startSchedule, type ScheduledTask } from './schedule.js';

const ALERT_CHECK_EVERY_MS = 60_000;
const HEARTBEAT_EVERY_MS = 5 * 60_000;

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
}

export interface Daemon {
  /** The dashboard: served by `listen`, or called in-process by tests. */
  app: Hono;
  /** Starts the generate, metrics sync and evolve schedules, the Alert checks and the heartbeat. */
  start(): void;
  /** Serves the dashboard on 127.0.0.1 only, at DASHBOARD_PORT. */
  listen(): Promise<AddressInfo>;
  /** Makes one Run with these options, as a Slot would: how the command line starts a Run. */
  generate(options: RunOptions): Promise<void>;
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
  const run = (options: RunOptions) => generate(deps, options).finally(() => alerts.check());
  const tasks: ScheduledTask[] = [
    { name: 'Generate', expression: config.schedule.generate, run: () => run(slotOptions) },
    { name: 'Metrics sync', expression: config.schedule.metrics, run: () => adapters.analytics.syncMetrics() },
    { name: 'Evolve', expression: config.schedule.evolve, run: () => adapters.analytics.evolve() },
  ];

  const app = new Hono();
  app.use(protect(config.dashboard.allowedHosts));
  app.get('/', (c) => {
    const now = clock.now();
    const nextUp = tasks.map((task) => ({ name: task.name, due: nextDue(task.expression, now) }));
    return c.html(frontPage({ now, startedAt, nextUp, alerts: alerts.active() }));
  });

  let stopSchedule = () => {};
  let stopAlertChecks = () => {};
  let stopHeartbeat = () => {};
  let server: ServerType | undefined;

  return {
    app,
    start() {
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
    generate: run,
    async stop() {
      stopSchedule();
      stopAlertChecks();
      stopHeartbeat();
      await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
      await alerts.idle();
      database.close();
    },
  };
}
