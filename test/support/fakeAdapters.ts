import fs from 'fs';
import path from 'path';
import type { Adapters } from '../../src/daemon/index.js';
import type { Config } from '../../src/loadConfig.js';
import type { Platform } from '../../src/platforms.js';
import { currentRun } from '../../src/runContext.js';
import type { PipelineResult, Push, RunOptions, RunProgress } from '../../src/types.js';
import type { FakeClock } from './fakeClock.js';
import { fakeStory, fakeStoryboard } from './fakeStory.js';

/** Adapters that record when each was called instead of leaving the process. */
export function fakeAdapters(clock: FakeClock, config: Config) {
  const calls = {
    pipeline: [] as Date[],
    pipelineOptions: [] as RunOptions[],
    syncMetrics: [] as Date[],
    evolve: [] as Date[],
    publish: [] as { platform: Platform; videoPath: string }[],
    /** Pushes that reached the phone; a failed push isn't one. */
    pushes: [] as ({ at: Date } & Push)[],
    heartbeat: [] as { at: Date; url: string }[],
  };
  /** Set one to make that adapter fail with it until it is cleared. */
  const failures: {
    pipeline?: Error;
    /** The step the Pipeline fails at, once it has started it; step 1 when unset. */
    pipelineStep?: number;
    publish: Partial<Record<Platform, string>>;
    push?: string;
    heartbeat?: string;
  } = { publish: {} };
  /** What each fake Run spends on paid Providers, taken in order; a Run spends nothing once it runs out. */
  const pipelineSpend: number[] = [];
  let runs = 0;

  /** Goes through the Pipeline's steps as the real one does, making a Run folder with a stand-in Video. */
  async function runPipeline(options: RunOptions, progress: RunProgress): Promise<PipelineResult> {
    const step = (n: number, message: string) => {
      progress.step(n, message);
      if (failures.pipeline && n === (failures.pipelineStep ?? 1)) throw failures.pipeline;
    };
    step(1, 'Finding story candidates...');
    step(2, 'Choosing and briefing the story...');
    step(3, 'Writing the storyboard...');
    const runDir = path.join(config.paths.outputDir, `${clock.now().getTime()}_${fakeStory.candidate.externalId}_${++runs}`);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'storyboard.json'), JSON.stringify({ brief: fakeStory, storyboard: fakeStoryboard }));
    progress.folder(runDir);
    const storyboarded = { story: fakeStory, storyboard: fakeStoryboard, strategyVersion: 1 };
    if (options.storyboardOnly) return storyboarded;

    step(4, 'Synthesizing voiceover...');
    step(5, 'Generating scene visuals...');
    const spend = pipelineSpend.shift();
    if (spend) currentRun()?.spend('image:fake', spend);
    step(6, 'Rendering 1080x1920 MP4...');
    const videoPath = path.join(runDir, `${path.basename(runDir)}_final.mp4`);
    fs.writeFileSync(videoPath, 'not really an mp4');
    return { ...storyboarded, video: { path: videoPath, durationSec: 42, voiceName: 'en-US-GuyNeural' } };
  }

  const adapters: Adapters = {
    clock,
    pipeline: {
      run: async (options, progress) => {
        calls.pipeline.push(clock.now());
        calls.pipelineOptions.push(options);
        return runPipeline(options, progress);
      },
    },
    platforms: {
      publish: async (platform, video) => {
        calls.publish.push({ platform, videoPath: video.path });
        const error = failures.publish[platform];
        if (error) return { platform, ok: false, error };
        const id = String(calls.publish.length);
        return { platform, ok: true, id, url: `https://${platform}.example/${id}` };
      },
    },
    analytics: {
      syncMetrics: async () => {
        calls.syncMetrics.push(clock.now());
      },
      evolve: async () => {
        calls.evolve.push(clock.now());
      },
    },
    notifier: {
      send: async (push) => {
        if (failures.push) throw new Error(failures.push);
        calls.pushes.push({ at: clock.now(), ...push });
      },
    },
    heartbeat: {
      ping: async (url) => {
        if (failures.heartbeat) throw new Error(failures.heartbeat);
        calls.heartbeat.push({ at: clock.now(), url });
      },
    },
  };
  return { adapters, calls, failures, pipelineSpend };
}
