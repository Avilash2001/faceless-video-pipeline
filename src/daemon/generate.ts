import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { finishRun, insertRun, recordStep, recordStoryboard, STARTED_BY, type RunRecord, type RunTrigger } from '../db/runs.js';
import { recordVideo } from '../db/videos.js';
import type { Config } from '../loadConfig.js';
import { isConfigured, PLATFORM_NAMES, PLATFORMS, type Platform, type PublishResult } from '../platforms.js';
import { withinRun } from '../runContext.js';
import { formatCost, insertSpend, OverBudgetError, spendForRunUsd, spendTodayUsd } from '../spend.js';
import type { RunOptions, RunProgress } from '../types.js';
import type { Adapters } from './index.js';
import { formatLocalTime } from './localTime.js';

export interface GenerateDeps extends Pick<Adapters, 'clock' | 'pipeline' | 'platforms'> {
  config: Config;
  database: DatabaseSync;
}

/** A Run that has started: its id, and its end, which rejects with the error when the Run fails. */
export interface StartedRun {
  id: string;
  done: Promise<void>;
}

/** A Run refused because another is in progress, which it names. */
export class RunInProgressError extends Error {
  constructor(readonly inProgress: RunRecord) {
    super(
      `Another Run is in progress: ${inProgress.id}, started ${formatLocalTime(inProgress.startedAt)} ` +
        `by ${STARTED_BY[inProgress.trigger]}. Try again once it has finished.`
    );
  }
}

/**
 * Starts a Run, however it was started, recording it as in progress; throws RunInProgressError
 * while another Run is, in this process or any other. The Pipeline takes it through steps 1 to 6,
 * then step 7 publishes the Video and the legacy video record is written. Everything printed
 * during the Run is kept in run.log in its folder, and spend made during it is recorded against it.
 */
export function startRun(deps: GenerateDeps, trigger: RunTrigger, options: RunOptions): StartedRun {
  const id = randomUUID();
  const inProgress = insertRun(deps.database, { id, trigger, options, startedAt: deps.clock.now() });
  if (inProgress) throw new RunInProgressError(inProgress);
  return { id, done: execute(deps, id, options) };
}

async function execute(deps: GenerateDeps, id: string, options: RunOptions): Promise<void> {
  const { clock, config, database } = deps;
  const log = new RunLog();
  const run = {
    log: (line: string) => log.write(line),
    spend: (item: string, usd: number) => insertSpend(database, item, usd, id),
  };
  // Spend rows carry this reference; keeping it in run.log ties them to the Run's folder.
  log.write(`[Pipeline] Run ${id}`);
  try {
    await withinRun(run, async () => {
      const progress: RunProgress = {
        step: (step, message) => {
          recordStep(database, id, step);
          console.log(`[Pipeline] ${step}/7 ${message}`);
        },
        storyboarded: (storyboarded) => {
          log.keepIn(storyboarded.folder);
          recordStoryboard(database, id, storyboarded);
        },
      };
      const result = await deps.pipeline.run(options, progress);
      if (!result.video) {
        finishRun(database, id, { outcome: 'storyboard_only', at: clock.now() });
        return;
      }

      let posts: PublishResult[] = [];
      if (config.schedule.enableAutoUpload && options.upload !== false) {
        progress.step(7, 'Publishing to YouTube Shorts, Instagram Reels, and Facebook Reels...');
        const video = { path: result.video.path, storyboard: result.storyboard };
        const publish = (platform: Platform): Promise<PublishResult> =>
          deps.platforms
            .publish(platform, video)
            // A publish that throws anyway mustn't lose the other Platforms' results or the record.
            .catch((err) => ({ platform, ok: false, error: (err as Error).message || String(err) }));
        const configured = PLATFORMS.filter((platform) => isConfigured(platform, config));
        for (const platform of PLATFORMS.filter((p) => !configured.includes(p))) {
          console.log(`[Publisher] Skipping ${PLATFORM_NAMES[platform]} (not configured).`);
        }
        posts = await Promise.all(configured.map(publish));
        for (const post of posts) {
          if (post.ok) console.log(`[Publisher] ${PLATFORM_NAMES[post.platform]}: ${post.url ?? `ID ${post.id}`}`);
          else console.warn(`[Publisher] ${PLATFORM_NAMES[post.platform]} failed: ${post.error}`);
        }
      } else {
        progress.step(7, 'Upload skipped (ENABLE_AUTO_UPLOAD=false or --no-upload). Saved locally.');
      }
      recordVideo(database, result, result.video, posts);
      const { durationSec, path: videoPath } = result.video;
      finishRun(database, id, { outcome: 'rendered', at: clock.now(), durationSec, videoPath });

      const cost = (usd: number) => formatCost(usd, config.costs);
      console.log(
        `[Pipeline] Run complete! API spend for this video: ${cost(spendForRunUsd(database, id))}; ` +
          `today: ${cost(spendTodayUsd(database))} of the $${config.costs.dailyBudgetUsd} daily budget.`
      );
    });
  } catch (err) {
    // Whoever started the Run prints the error; the Run's log keeps it too.
    log.write(`[Pipeline] Run failed: ${(err as Error)?.stack ?? err}`);
    try {
      finishRun(database, id, {
        outcome: 'failed',
        at: clock.now(),
        error: (err as Error)?.message || String(err),
        reason: err instanceof OverBudgetError ? 'over budget' : undefined,
        log: log.unsaved(),
      });
    } catch (recordErr) {
      // The Run's own error matters more; it stays in progress until the daemon next starts.
      console.error(`[Pipeline] Couldn't record the failed Run ${id}: ${(recordErr as Error).message || String(recordErr)}`);
    }
    throw err;
  }
}

/** A Run's log: held in memory until the Run has a folder, then kept in run.log there. */
class RunLog {
  private pending: string[] = [];
  private file: string | undefined;

  write(line: string): void {
    if (this.file) fs.appendFileSync(this.file, `${line}\n`);
    else this.pending.push(line);
  }

  keepIn(dir: string): void {
    this.file = path.join(dir, 'run.log');
    fs.appendFileSync(this.file, this.pendingText());
    this.pending = [];
  }

  /** The log so far, while it has no folder to be kept in. */
  unsaved(): string | undefined {
    return this.file ? undefined : this.pendingText();
  }

  private pendingText(): string {
    return this.pending.map((line) => `${line}\n`).join('');
  }
}
