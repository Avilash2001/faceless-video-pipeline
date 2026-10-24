import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { CONFIG, ImageProviderName, MotionProviderName } from './config.js';
import { db, initDatabase } from './db/index.js';
import { GENRES } from './genres.js';
import {
  evolveStrategyRules,
  syncCrossPlatformMetrics,
} from './services/analyticsLoop.js';
import { buildSfxEvents, pickMusicTrack } from './services/audioAssets.js';
import { generateStoryboard } from './services/llmEngine.js';
import { publishAcrossPlatforms } from './services/publisher.js';
import { alignScenesToTimings } from './services/sceneTiming.js';
import { selectAndBriefStory } from './services/storyEditor.js';
import { buildAssSubtitles } from './services/subtitleBuilder.js';
import { synthesizeSpeechWithTimings } from './services/ttsEngine.js';
import { composeFinalShortMp4 } from './services/videoComposer.js';
import { findStoryCandidates } from './sources/index.js';
import { pickRandom } from './sources/util.js';
import { NicheCategory, StoryBrief, Storyboard, StrategyRules } from './types.js';
import { generateSceneMedia } from './visuals/index.js';

export interface RunOptions {
  /** Force a genre instead of letting the bandit pick. */
  niche?: NicheCategory;
  /** Stop after writing the storyboard (no TTS, image generation, or rendering). */
  storyboardOnly?: boolean;
  /** Set false to skip publishing even when ENABLE_AUTO_UPLOAD=true. */
  upload?: boolean;
  /** Re-render a saved output/<run>/storyboard.json instead of finding a new story. */
  storyboardPath?: string;
}

/**
 * Executes one end-to-end cycle: find a story, storyboard it, voice it, generate a visual
 * per scene, render, and (optionally) publish to YouTube Shorts, IG Reels, and FB Reels.
 */
export async function runSinglePipelineCycle(opts: RunOptions = {}): Promise<void> {
  initDatabase();
  const strategy: StrategyRules = JSON.parse(
    fs.readFileSync(CONFIG.paths.strategyFile, 'utf-8')
  );

  let brief: StoryBrief;
  let storyboard: Storyboard;
  if (opts.storyboardPath) {
    ({ brief, storyboard } = JSON.parse(fs.readFileSync(opts.storyboardPath, 'utf-8')));
    console.log(`[Pipeline] 1-3/7 Reusing storyboard "${storyboard.youtubeMetadata.title}" from ${opts.storyboardPath}`);
  } else {
    console.log(`[Pipeline] 1/7 Finding story candidates (Strategy v${strategy.version})...`);
    const { niche, candidates } = await findStoryCandidates(strategy, opts.niche);
    console.log(`[Pipeline] ${candidates.length} candidate(s) for [${niche}] from ${GENRES[niche].source}`);

    console.log('[Pipeline] 2/7 Choosing and briefing the story...');
    brief = await selectAndBriefStory(niche, candidates);
    console.log(`[Pipeline] Story: "${brief.candidate.title}" — ${brief.premise}`);

    console.log('[Pipeline] 3/7 Writing the storyboard...');
    storyboard = await generateStoryboard(brief, strategy);
  }
  const runId = `${Date.now()}_${brief.candidate.externalId}`;
  const runDir = path.join(CONFIG.paths.outputDir, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'storyboard.json'), JSON.stringify({ brief, storyboard }, null, 2));
  console.log(
    `[Pipeline] ${storyboard.scenes.length} scenes, ${storyboard.fullNarrationText.split(/\s+/).length} words, ` +
      `style "${storyboard.visualStyle.name}", hook "${storyboard.hookOverlayText}"`
  );

  if (opts.storyboardOnly) {
    storyboard.scenes.forEach((s) => console.log(`  [${s.index}] ${s.narration}`));
    console.log(`[Pipeline] Storyboard only: saved ${path.join(runDir, 'storyboard.json')}`);
    return;
  }

  const voicePool = strategy.voicePool[storyboard.narratorGender] || Object.values(strategy.voicePool).flat();
  const voiceName = pickRandom(voicePool);
  console.log(`[Pipeline] 4/7 Synthesizing voiceover (${voiceName}) & word timings...`);
  const tts = await synthesizeSpeechWithTimings(
    storyboard.fullNarrationText,
    voiceName,
    strategy.voiceSpeedRate,
    runDir,
    'story'
  );
  const timedScenes = alignScenesToTimings(storyboard.scenes, tts.wordTimings, tts.durationSeconds * 1000);

  console.log(
    `[Pipeline] 5/7 Generating scene visuals (images: ${CONFIG.visuals.imageProvider}, motion: ${CONFIG.visuals.motionProvider})...`
  );
  const visuals = await generateSceneMedia(storyboard, timedScenes, runDir);
  const byProvider = visuals.media.reduce<Record<string, number>>((acc, m) => {
    acc[m.provider] = (acc[m.provider] || 0) + 1;
    return acc;
  }, {});
  console.log(
    `[Pipeline] Visuals ready: ${Object.entries(byProvider).map(([p, n]) => `${n}x ${p}`).join(', ')} ` +
      `(est. $${visuals.estimatedCostUsd.toFixed(2)})`
  );
  fs.writeFileSync(
    path.join(runDir, 'timing.json'),
    JSON.stringify(
      timedScenes.map((s) => ({
        index: s.index,
        startMs: s.startMs,
        endMs: s.endMs,
        narration: s.narration,
        media: visuals.media[s.index],
      })),
      null,
      2
    )
  );

  console.log('[Pipeline] 6/7 Rendering 1080x1920 MP4...');
  const assPath = buildAssSubtitles(tts.wordTimings, runDir, 'story', storyboard.hookOverlayText);
  const mp4Path = await composeFinalShortMp4({
    scenes: timedScenes,
    media: visuals.media,
    audioPath: tts.audioFilePath,
    assSubtitlePath: assPath,
    durationSeconds: tts.durationSeconds,
    outputDir: runDir,
    filePrefix: runId,
    musicPath: pickMusicTrack(storyboard.musicMood),
    sfx: buildSfxEvents(timedScenes),
  });
  console.log(`[Pipeline] Rendered MP4: ${mp4Path}`);

  let ytId: string | undefined;
  let igId: string | undefined;
  let fbId: string | undefined;

  if (CONFIG.schedule.enableAutoUpload && opts.upload !== false) {
    console.log('[Pipeline] 7/7 Publishing to YouTube Shorts, Instagram Reels, and Facebook Reels...');
    const pubResult = await publishAcrossPlatforms(mp4Path, storyboard);
    ytId = pubResult.youtubeVideoId;
    igId = pubResult.instagramMediaId;
    fbId = pubResult.facebookVideoId;
    if (pubResult.errors.length > 0) {
      console.warn('[Publisher Warnings]:', pubResult.errors);
    }
  } else {
    console.log('[Pipeline] 7/7 Upload skipped (ENABLE_AUTO_UPLOAD=false or --no-upload). Saved locally.');
  }

  // Re-rendering a saved storyboard updates its existing row instead of failing the UNIQUE source id.
  db.prepare(
    `INSERT INTO videos (
      source_external_id, source_url, niche, hook_archetype, voice_name,
      strategy_version, script_json, duration_sec, mp4_path,
      yt_video_id, ig_media_id, fb_video_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_external_id) DO UPDATE SET
      voice_name = excluded.voice_name,
      script_json = excluded.script_json,
      duration_sec = excluded.duration_sec,
      mp4_path = excluded.mp4_path,
      yt_video_id = COALESCE(excluded.yt_video_id, yt_video_id),
      ig_media_id = COALESCE(excluded.ig_media_id, ig_media_id),
      fb_video_id = COALESCE(excluded.fb_video_id, fb_video_id)`
  ).run(
    brief.candidate.externalId,
    brief.candidate.sourceUrl || '',
    storyboard.niche,
    storyboard.hookArchetype,
    voiceName,
    strategy.version,
    JSON.stringify(storyboard),
    tts.durationSeconds,
    mp4Path,
    ytId || null,
    igId || null,
    fbId || null
  );

  console.log('[Pipeline] Cycle complete!');
}

function argValue(args: string[], name: string): string | undefined {
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.split('=')[1];
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function applyOverrides(args: string[]): RunOptions {
  const genre = argValue(args, 'genre');
  if (genre && !(genre in GENRES)) {
    throw new Error(`Unknown --genre "${genre}". Options: ${Object.keys(GENRES).join(', ')}`);
  }
  const images = argValue(args, 'images');
  if (images) CONFIG.visuals.imageProvider = images as ImageProviderName;
  const motion = argValue(args, 'motion');
  if (motion) CONFIG.visuals.motionProvider = motion as MotionProviderName;

  return {
    niche: genre as NicheCategory | undefined,
    storyboardOnly: args.includes('--storyboard-only'),
    upload: !args.includes('--no-upload'),
    storyboardPath: argValue(args, 'storyboard'),
  };
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

  const runOptions = applyOverrides(args);

  if (args.includes('--daemon')) {
    console.log('[Daemon] Starting autonomous cron workers...');
    cron.schedule(CONFIG.schedule.generate, () => {
      runSinglePipelineCycle(runOptions).catch((err) =>
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

  await runSinglePipelineCycle(runOptions);
}

main().catch((err) => {
  console.error('[Fatal Pipeline Error]:', err);
  process.exit(1);
});
