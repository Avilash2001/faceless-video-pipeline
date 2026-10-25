import os from 'os';
import { CONFIG, ImageProviderName, MotionProviderName } from './config.js';
import { systemClock } from './daemon/clock.js';
import { RunInProgressError } from './daemon/generate.js';
import { Adapters, createDaemon } from './daemon/index.js';
import { GENRES } from './genres.js';
import { runPipeline } from './pipeline.js';
import {
  evolveStrategyRules,
  syncCrossPlatformMetrics,
} from './services/analyticsLoop.js';
import { pingHealthcheck } from './services/healthcheck.js';
import { sendToNtfy } from './services/ntfy.js';
import { publishToPlatform } from './services/publisher.js';
import { NicheCategory, RunOptions } from './types.js';

function argValue(args: string[], name: string): string | undefined {
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.split('=')[1];
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

/** A Run's options from the command line; they apply to that Run only, never to the global config. */
function parseRunOptions(args: string[]): RunOptions {
  const genre = argValue(args, 'genre');
  if (genre && !(genre in GENRES)) {
    throw new Error(`Unknown --genre "${genre}". Options: ${Object.keys(GENRES).join(', ')}`);
  }

  return {
    genre: genre as NicheCategory | undefined,
    imageProvider: argValue(args, 'images') as ImageProviderName | undefined,
    motionProvider: argValue(args, 'motion') as MotionProviderName | undefined,
    storyboardOnly: args.includes('--storyboard-only'),
    upload: !args.includes('--no-upload'),
    storyboardPath: argValue(args, 'storyboard'),
    reuseVisualsDir: argValue(args, 'reuse-visuals'),
  };
}

const adapters: Adapters = {
  clock: systemClock,
  pipeline: { run: runPipeline },
  platforms: { publish: publishToPlatform },
  analytics: {
    syncMetrics: syncCrossPlatformMetrics,
    evolve: async () => {
      await evolveStrategyRules();
    },
  },
  notifier: { send: (push) => sendToNtfy(CONFIG.alerts, push) },
  heartbeat: { ping: pingHealthcheck },
  processControl: {
    // pm2 sets pm_id in the environment of every process it runs.
    canRestart: () => process.env.pm_id !== undefined,
    // pm2 starts the daemon again whenever it exits, so exiting is the restart.
    restart: () => process.exit(0),
  },
};

async function main() {
  const args = process.argv.slice(2);
  const runOptions = parseRunOptions(args);
  // The daemon gives every Slot's Run the flags it was started with.
  const daemon = createDaemon(CONFIG, adapters, { slotOptions: runOptions });
  // Ctrl-C, a closed terminal or pm2 stopping the daemon cuts the process's Run off. Mark it
  // interrupted before exiting, so it doesn't hold up every other Run until the daemon next starts.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(signal, () => {
      try {
        daemon.interrupt();
      } finally {
        process.exit(128 + os.constants.signals[signal]);
      }
    });
  }

  if (args.includes('--daemon')) {
    daemon.start();
    const { port } = await daemon.listen();
    console.log(`[Daemon] Schedules running; dashboard at http://localhost:${port}`);
    if (!CONFIG.alerts.ntfyTopic) console.log('[Daemon] NTFY_TOPIC is not set: Alerts show on the dashboard only.');
    return;
  }

  // One-off commands go through the same Daemon as the schedule, without starting its schedule or
  // web server, so a command-line Run is recorded like any other.
  try {
    if (args.includes('--sync-metrics')) await daemon.syncMetrics();
    else if (args.includes('--evolve')) await daemon.evolve();
    else await daemon.generate(runOptions);
  } finally {
    await daemon.stop();
  }
}

main().catch((err) => {
  if (err instanceof RunInProgressError) console.error(`[Pipeline] Refused: ${err.message}`);
  else console.error('[Fatal Pipeline Error]:', err);
  process.exit(1);
});
