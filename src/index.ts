import fs from 'fs';
import cron from 'node-cron';
import { CONFIG } from './config.js';
import { db, initDatabase } from './db/index.js';
import {
  evolveStrategyRules,
  syncCrossPlatformMetrics,
} from './services/analyticsLoop.js';
import { generateTransformativeScript } from './services/llmEngine.js';
import { publishAcrossPlatforms } from './services/publisher.js';
import { buildAssSubtitles } from './services/subtitleBuilder.js';
import { findBestTrendingTopic } from './services/trendFinder.js';
import { synthesizeSpeechWithTimings } from './services/ttsEngine.js';
import { composeFinalShortMp4 } from './services/videoComposer.js';
import {
  renderTitleCardPng,
  resolveBrollClipsForSegments,
} from './services/visualEngine.js';
import { StrategyRules } from './types.js';

/**
 * Executes one end-to-end generation + render + multi-platform publish cycle.
 */
export async function runSinglePipelineCycle(): Promise<void> {
  initDatabase();
  const strategy: StrategyRules = JSON.parse(
    fs.readFileSync(CONFIG.paths.strategyFile, 'utf-8')
  );

  console.log(`[Pipeline] 1/6 Discovering top trending story (Strategy v${strategy.version})...`);
  const candidate = await findBestTrendingTopic(strategy);
  console.log(
    `[Pipeline] Selected [${candidate.niche}] "${candidate.title}" (Velocity: ${candidate.velocityScore.toFixed(1)})`
  );

  console.log('[Pipeline] 2/6 Generating transformative script & multi-platform metadata via Gemini...');
  const script = await generateTransformativeScript(candidate, strategy);

  const filePrefix = `${Date.now()}_${candidate.externalId}`;
  const voiceName =
    strategy.voicePool[Math.floor(Math.random() * strategy.voicePool.length)];

  console.log(`[Pipeline] 3/6 Synthesizing voiceover (${voiceName}) & extracting word timings...`);
  const ttsResult = await synthesizeSpeechWithTimings(
    script.fullNarrationText,
    voiceName,
    strategy.voiceSpeedRate,
    CONFIG.paths.outputDir,
    filePrefix
  );

  console.log('[Pipeline] 4/6 Building .ass karaoke subtitles & resolving B-roll...');
  const assPath = buildAssSubtitles(
    ttsResult.wordTimings,
    CONFIG.paths.outputDir,
    filePrefix,
    script.titleCardBadge,
    script.titleCardHeadline
  );
  const titleCardPng = await renderTitleCardPng(
    script.titleCardBadge,
    script.titleCardHeadline,
    CONFIG.paths.outputDir,
    filePrefix
  );
  const brollClips = await resolveBrollClipsForSegments(script.segments);

  console.log('[Pipeline] 5/6 Rendering final 1080x1920 MP4 via FFmpeg...');
  const mp4Path = await composeFinalShortMp4({
    brollClips,
    audioPath: ttsResult.audioFilePath,
    assSubtitlePath: assPath,
    titleCardPngPath: titleCardPng,
    durationSeconds: ttsResult.durationSeconds,
    outputDir: CONFIG.paths.outputDir,
    filePrefix,
  });
  console.log(`[Pipeline] Rendered MP4: ${mp4Path}`);

  let ytId: string | undefined;
  let igId: string | undefined;
  let fbId: string | undefined;

  if (CONFIG.schedule.enableAutoUpload) {
    console.log('[Pipeline] 6/6 Publishing concurrently to YouTube Shorts, Instagram Reels, and Facebook Reels...');
    const pubResult = await publishAcrossPlatforms(mp4Path, script);
    ytId = pubResult.youtubeVideoId;
    igId = pubResult.instagramMediaId;
    fbId = pubResult.facebookVideoId;
    if (pubResult.errors.length > 0) {
      console.warn('[Publisher Warnings]:', pubResult.errors);
    }
  } else {
    console.log('[Pipeline] 6/6 Auto-upload disabled (ENABLE_AUTO_UPLOAD=false). Saved locally.');
  }

  db.prepare(
    `INSERT INTO videos (
      source_external_id, source_url, niche, hook_archetype, voice_name,
      strategy_version, script_json, duration_sec, mp4_path,
      yt_video_id, ig_media_id, fb_video_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    candidate.externalId,
    candidate.sourceUrl,
    script.niche,
    script.hookArchetype,
    voiceName,
    strategy.version,
    JSON.stringify(script),
    ttsResult.durationSeconds,
    mp4Path,
    ytId || null,
    igId || null,
    fbId || null
  );

  console.log('[Pipeline] Cycle complete!');
}

async function main() {
  initDatabase();
  const args = process.argv.slice(2);

  if (args.includes('--sync-metrics')) {
    await syncCrossPlatformMetrics();
    return;
  }

  if (args.includes('--evolve')) {
    await evolveStrategyRules();
    return;
  }

  if (args.includes('--daemon')) {
    console.log('[Daemon] Starting autonomous cron workers...');
    cron.schedule(CONFIG.schedule.generate, () => {
      runSinglePipelineCycle().catch((err) =>
        console.error('[Daemon Generate Error]:', err)
      );
    });
    cron.schedule(CONFIG.schedule.metrics, () => {
      syncCrossPlatformMetrics().catch((err) =>
        console.error('[Daemon Metrics Error]:', err)
      );
    });
    cron.schedule(CONFIG.schedule.evolve, () => {
      evolveStrategyRules().catch((err) =>
        console.error('[Daemon Evolve Error]:', err)
      );
    });
    return;
  }

  await runSinglePipelineCycle();
}

main().catch((err) => {
  console.error('[Fatal Pipeline Error]:', err);
  process.exit(1);
});
