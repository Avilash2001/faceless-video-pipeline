import { CONFIG, ImageProviderName, MotionProviderName } from './config.js';
import { systemClock } from './daemon/clock.js';
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
};

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--sync-metrics')) {
    await syncCrossPlatformMetrics();
    return;
  }

  if (args.includes('--evolve')) {
    await evolveStrategyRules();
    return;
  }

  const runOptions = parseRunOptions(args);
  // The daemon gives every Slot's Run the flags it was started with.
  const daemon = createDaemon(CONFIG, adapters, { slotOptions: runOptions });

  if (args.includes('--daemon')) {
    daemon.start();
    const { port } = await daemon.listen();
    console.log(`[Daemon] Schedules running; dashboard at http://localhost:${port}`);
    if (!CONFIG.alerts.ntfyTopic) console.log('[Daemon] NTFY_TOPIC is not set: Alerts show on the dashboard only.');
    return;
  }

  try {
    await daemon.generate(runOptions);
  } finally {
    await daemon.stop();
  }
}

main().catch((err) => {
  console.error('[Fatal Pipeline Error]:', err);
  process.exit(1);
});
