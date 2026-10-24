import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import type { AddressInfo } from 'net';
import { openDatabase } from '../db/open.js';
import type { Config } from '../loadConfig.js';
import type { Platform, PublishResult, VideoToPublish } from '../platforms.js';
import type { PipelineResult, RunOptions, RunProgress } from '../types.js';
import type { Clock } from './clock.js';
import { generate } from './generate.js';
import { frontPage } from './pages.js';
import { protect } from './protect.js';
import { nextDue, startSchedule, type ScheduledTask } from './schedule.js';

/** Everything the Daemon reaches outside the process through. Tests pass fakes. */
export interface Adapters {
  clock: Clock;
  /** Finds a Story and takes it through to a rendered Video: steps 1 to 6 of a Run. */
  pipeline: { run(options: RunOptions, progress: RunProgress): Promise<PipelineResult> };
  /** Publishes one Video to one Platform, returning how it went rather than throwing. */
  platforms: { publish(platform: Platform, video: VideoToPublish): Promise<PublishResult> };
  /** The learning loop: pulls Post metrics, and evolves the strategy from them. */
  analytics: { syncMetrics(): Promise<void>; evolve(): Promise<void> };
}

export interface Daemon {
  /** The dashboard: served by `listen`, or called in-process by tests. */
  app: Hono;
  /** Starts the generate, metrics sync and evolve schedules. */
  start(): void;
  /** Serves the dashboard on 127.0.0.1 only, at DASHBOARD_PORT. */
  listen(): Promise<AddressInfo>;
  /** Makes one Run with these options, as a Slot would: how the command line starts a Run. */
  generate(options: RunOptions): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Builds the daemon: the schedule and the dashboard, in one process (ADR 0001). Every Slot's Run
 * gets `slotOptions`: the flags `pnpm daemon` was started with.
 */
export function createDaemon(config: Config, adapters: Adapters, slotOptions: RunOptions = {}): Daemon {
  const { clock } = adapters;
  const database = openDatabase(config.paths.dbFile);
  const startedAt = clock.now();
  const deps = { ...adapters, config, database };
  const tasks: ScheduledTask[] = [
    { name: 'Generate', expression: config.schedule.generate, run: () => generate(deps, slotOptions) },
    { name: 'Metrics sync', expression: config.schedule.metrics, run: () => adapters.analytics.syncMetrics() },
    { name: 'Evolve', expression: config.schedule.evolve, run: () => adapters.analytics.evolve() },
  ];

  const app = new Hono();
  app.use(protect(config.dashboard.allowedHosts));
  app.get('/', (c) => {
    const now = clock.now();
    const nextUp = tasks.map((task) => ({ name: task.name, due: nextDue(task.expression, now) }));
    return c.html(frontPage({ now, startedAt, nextUp }));
  });

  let stopSchedule = () => {};
  let server: ServerType | undefined;

  return {
    app,
    start() {
      stopSchedule = startSchedule(clock, tasks);
    },
    listen() {
      return new Promise((resolve) => {
        server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: config.dashboard.port }, resolve);
      });
    },
    generate(options) {
      return generate(deps, options);
    },
    async stop() {
      stopSchedule();
      await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
      database.close();
    },
  };
}
