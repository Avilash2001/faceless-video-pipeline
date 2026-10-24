import fs from 'fs';
import path from 'path';
import { CONFIG } from './config.js';
import { GENRES } from './genres.js';
import { buildSfxEvents, pickMusicTrack } from './services/audioAssets.js';
import { ensureCleanEnding, generateStoryboard } from './services/llmEngine.js';
import { alignScenesToTimings } from './services/sceneTiming.js';
import { selectAndBriefStory } from './services/storyEditor.js';
import { buildAssSubtitles } from './services/subtitleBuilder.js';
import { synthesizeSpeechWithTimings } from './services/ttsEngine.js';
import { composeFinalShortMp4 } from './services/videoComposer.js';
import { findStoryCandidates } from './sources/index.js';
import { pickRandom } from './sources/util.js';
import {
  PipelineResult,
  RunOptions,
  RunProgress,
  SceneMedia,
  StoryBrief,
  Storyboard,
  StrategyRules,
} from './types.js';
import { generateSceneMedia } from './visuals/index.js';

/**
 * Steps 1 to 6 of a Run: find a story, storyboard it, voice it, generate a visual per scene and
 * render. Publishing (step 7) is up to the caller.
 */
export async function runPipeline(options: RunOptions, progress: RunProgress): Promise<PipelineResult> {
  const strategy: StrategyRules = JSON.parse(
    fs.readFileSync(CONFIG.paths.strategyFile, 'utf-8')
  );

  let brief: StoryBrief;
  let storyboard: Storyboard;
  if (options.storyboardPath) {
    ({ brief, storyboard } = JSON.parse(fs.readFileSync(options.storyboardPath, 'utf-8')));
    progress.step(3, `Reusing storyboard "${storyboard.youtubeMetadata.title}" from ${options.storyboardPath}`);
    storyboard = await ensureCleanEnding(storyboard);
  } else {
    progress.step(1, `Finding story candidates (Strategy v${strategy.version})...`);
    const { niche, candidates } = await findStoryCandidates(strategy, options.genre);
    console.log(`[Pipeline] ${candidates.length} candidate(s) for [${niche}] from ${GENRES[niche].source}`);

    progress.step(2, 'Choosing and briefing the story...');
    brief = await selectAndBriefStory(niche, candidates);
    console.log(`[Pipeline] Story: "${brief.candidate.title}" — ${brief.premise}`);

    progress.step(3, 'Writing the storyboard...');
    storyboard = await generateStoryboard(brief, strategy);
  }
  const runName = `${Date.now()}_${brief.candidate.externalId}`;
  const runDir = path.join(CONFIG.paths.outputDir, runName);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'storyboard.json'), JSON.stringify({ brief, storyboard }, null, 2));
  progress.folder(runDir);
  console.log(
    `[Pipeline] ${storyboard.scenes.length} scenes, ${storyboard.fullNarrationText.split(/\s+/).length} words, ` +
      `style "${storyboard.visualStyle.name}", hook "${storyboard.hookOverlayText}"`
  );
  const storyboarded = { story: brief, storyboard, strategyVersion: strategy.version };

  if (options.storyboardOnly) {
    storyboard.scenes.forEach((s) => console.log(`  [${s.index}] ${s.narration}`));
    console.log(`[Pipeline] Storyboard only: saved ${path.join(runDir, 'storyboard.json')}`);
    return storyboarded;
  }

  const voicePool = strategy.voicePool[storyboard.narratorGender] || Object.values(strategy.voicePool).flat();
  const voiceName = pickRandom(voicePool);
  progress.step(4, `Synthesizing voiceover (${voiceName}) & word timings...`);
  const tts = await synthesizeSpeechWithTimings(
    storyboard.fullNarrationText,
    voiceName,
    strategy.voiceSpeedRate,
    runDir,
    'story'
  );
  const timedScenes = alignScenesToTimings(storyboard.scenes, tts.wordTimings, tts.durationSeconds * 1000);

  const providers = {
    image: options.imageProvider ?? CONFIG.visuals.imageProvider,
    motion: options.motionProvider ?? CONFIG.visuals.motionProvider,
  };
  progress.step(5, `Generating scene visuals (images: ${providers.image}, motion: ${providers.motion})...`);
  const visuals = options.reuseVisualsDir
    ? reuseVisuals(options.reuseVisualsDir, timedScenes.length)
    : await generateSceneMedia(storyboard, timedScenes, runDir, providers);
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

  progress.step(6, 'Rendering 1080x1920 MP4...');
  const assPath = buildAssSubtitles(tts.wordTimings, runDir, 'story', storyboard.hookOverlayText);
  const mp4Path = await composeFinalShortMp4({
    scenes: timedScenes,
    media: visuals.media,
    audioPath: tts.audioFilePath,
    assSubtitlePath: assPath,
    durationSeconds: tts.durationSeconds,
    outputDir: runDir,
    filePrefix: runName,
    musicPath: pickMusicTrack(storyboard.musicMood),
    sfx: buildSfxEvents(timedScenes),
  });
  console.log(`[Pipeline] Rendered MP4: ${mp4Path}`);

  return { ...storyboarded, video: { path: mp4Path, durationSec: tts.durationSeconds, voiceName } };
}

function reuseVisuals(dir: string, sceneCount: number) {
  const timing = JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf-8')) as { media: SceneMedia }[];
  if (timing.length !== sceneCount) {
    throw new Error(`--reuse-visuals: ${dir} has ${timing.length} scenes but this storyboard has ${sceneCount}.`);
  }
  console.log(`[Pipeline] Reusing ${sceneCount} scene visuals from ${dir} (no image cost).`);
  return { media: timing.map((t) => t.media), estimatedCostUsd: 0 };
}
