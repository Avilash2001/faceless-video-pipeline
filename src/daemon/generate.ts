import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { recordVideo } from '../db/videos.js';
import type { Config } from '../loadConfig.js';
import { isConfigured, PLATFORM_NAMES, PLATFORMS, type Platform, type PublishResult } from '../platforms.js';
import { withinRun } from '../runContext.js';
import { formatCost, insertSpend, spendForRunUsd, spendTodayUsd } from '../spend.js';
import type { RunOptions, RunProgress } from '../types.js';
import type { Adapters } from './index.js';

export interface GenerateDeps extends Pick<Adapters, 'pipeline' | 'platforms'> {
  config: Config;
  database: DatabaseSync;
}

/**
 * One Run, however it was started. The Pipeline takes it through steps 1 to 6, then step 7
 * publishes the Video and the legacy video record is written. Everything printed during the Run
 * is kept in run.log in its folder, and spend made during it is recorded against it.
 */
export async function generate(deps: GenerateDeps, options: RunOptions): Promise<void> {
  const { config, database } = deps;
  const runId = randomUUID();
  const log = new RunLog();
  const run = {
    log: (line: string) => log.write(line),
    spend: (item: string, usd: number) => insertSpend(database, item, usd, runId),
  };
  // Spend rows carry this reference; keeping it in run.log ties them to the Run's folder.
  log.write(`[Pipeline] Run ${runId}`);
  await withinRun(run, async () => {
    const progress: RunProgress = {
      step: (step, message) => console.log(`[Pipeline] ${step}/7 ${message}`),
      folder: (dir) => log.keepIn(dir),
    };
    const result = await deps.pipeline.run(options, progress).catch((err) => {
      // Whoever started the Run prints the error; the Run's log keeps it too.
      log.write(`[Pipeline] Run failed: ${(err as Error)?.stack ?? err}`);
      throw err;
    });
    if (!result.video) return;

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

    const cost = (usd: number) => formatCost(usd, config.costs);
    console.log(
      `[Pipeline] Run complete! API spend for this video: ${cost(spendForRunUsd(database, runId))}; ` +
        `today: ${cost(spendTodayUsd(database))} of the $${config.costs.dailyBudgetUsd} daily budget.`
    );
  });
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
    fs.appendFileSync(this.file, this.pending.map((line) => `${line}\n`).join(''));
    this.pending = [];
  }
}
