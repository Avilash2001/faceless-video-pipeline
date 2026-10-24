import fs from 'fs';
import path from 'path';
import { CONFIG, ImageProviderName, MotionProviderName } from '../config.js';
import { formatCost, recordSpend, todaysSpendUsd, withinBudget } from '../services/costs.js';
import { SceneMedia, Storyboard, TimedScene } from '../types.js';
import { comfyImageProvider } from './images/comfyui.js';
import { falImageProvider } from './images/fal.js';
import { geminiImageProvider } from './images/gemini.js';
import { stockProvider } from './images/stock.js';
import { comfyMotionProvider } from './motion/comfyui.js';
import { falMotionProvider } from './motion/fal.js';
import { geminiMotionProvider } from './motion/gemini.js';
import { castSheetPrompt, imageSafe, sceneCharacters, scenePrompt } from './prompts.js';
import { ImageJob, ImageProvider, MotionProvider } from './types.js';

const IMAGE_PROVIDERS: Record<ImageProviderName, ImageProvider> = {
  gemini: geminiImageProvider,
  comfyui: comfyImageProvider,
  fal: falImageProvider,
  stock: stockProvider,
};

const MOTION_PROVIDERS: Record<Exclude<MotionProviderName, 'none'>, MotionProvider> = {
  gemini: geminiMotionProvider,
  fal: falMotionProvider,
  comfyui: comfyMotionProvider,
};

export interface VisualsResult {
  media: SceneMedia[];
  estimatedCostUsd: number;
}

/**
 * Produces one visual per scene while spending as little as possible:
 * 1. one cast reference sheet for all recurring characters (when the provider uses references),
 * 2. an image per distinct shot; scenes marked sameShotAsPrevious reuse the previous image with
 *    a different camera move. Each shot is retried once, then IMAGE_FALLBACK is used,
 * 3. optional AI motion clips for the hook (MOTION_PROVIDER, MOTION_CLIPS_PER_VIDEO).
 * Paid providers are skipped when they would push today's spend past DAILY_BUDGET_USD.
 */
export async function generateSceneMedia(
  storyboard: Storyboard,
  scenes: TimedScene[],
  runDir: string
): Promise<VisualsResult> {
  let primary = IMAGE_PROVIDERS[CONFIG.visuals.imageProvider];
  if (!primary) throw new Error(`Unknown IMAGE_PROVIDER "${CONFIG.visuals.imageProvider}"`);
  const fallback =
    CONFIG.visuals.imageFallback !== 'none' && CONFIG.visuals.imageFallback !== primary.name
      ? IMAGE_PROVIDERS[CONFIG.visuals.imageFallback]
      : undefined;

  const dir = path.join(runDir, 'scenes');
  fs.mkdirSync(dir, { recursive: true });
  const baseSeed = Math.floor(Math.random() * 1_000_000_000);
  let cost = 0;
  const pay = (item: string, usd: number) => {
    if (usd <= 0) return;
    cost += usd;
    recordSpend(item, usd);
  };

  // Quota/billing errors won't fix themselves within a run: stop calling that provider.
  const disabled = new Set<string>();
  const noteFailure = (provider: { name: string }, err: unknown) => {
    const message = (err as Error).message || String(err);
    if (/RESOURCE_EXHAUSTED|quota|limit: 0|billing|spending cap|insufficient.*(credit|balance)|exhausted balance|ECONNREFUSED/i.test(message)) {
      if (!disabled.has(provider.name)) {
        console.warn(`[Visuals] Disabling ${provider.name} for this run: ${message.split('\n')[0].slice(0, 200)}`);
      }
      disabled.add(provider.name);
    }
    return message;
  };

  const shots = scenes.filter((s) => s.index === 0 || !s.sameShotAsPrevious);
  const hasCast = storyboard.characters.length > 0 && scenes.some((s) => s.characterIds.length > 0);
  const estimate = (shots.length + (primary.supportsRefs && hasCast ? 1 : 0)) * primary.costPerImageUsd;
  if (estimate > 0 && !withinBudget(estimate)) {
    const budgetNote =
      `${primary.name} would cost ~${formatCost(estimate)}, over the daily budget ` +
      `($${todaysSpendUsd().toFixed(2)} of $${CONFIG.costs.dailyBudgetUsd} spent today)`;
    // Only switch to a free provider that keeps the illustrated look; generic stock footage
    // would publish a worse video than skipping one.
    if (fallback?.name === 'comfyui') {
      console.warn(`[Visuals] ${budgetNote}. Using comfyui instead.`);
      primary = fallback;
    } else {
      throw new Error(`Daily budget reached: ${budgetNote}. Skipping this video; raise DAILY_BUDGET_USD or set IMAGE_FALLBACK=comfyui.`);
    }
  }
  const needsSheet = primary.supportsRefs && hasCast;
  console.log(
    `[Visuals] ${shots.length} distinct shots for ${scenes.length} scenes${needsSheet ? ' + 1 cast sheet' : ''} via ${primary.name}`
  );

  let sheetPath: string | null = null;
  if (needsSheet) {
    try {
      const sheet = await primary.generate({
        prompt: castSheetPrompt(storyboard),
        refImages: [],
        aspectRatio: storyboard.characters.length > 1 ? '16:9' : '1:1',
        seed: baseSeed,
        outBase: path.join(dir, 'cast_sheet'),
      });
      sheetPath = sheet.path;
      pay(`image:${primary.name}`, primary.costPerImageUsd);
    } catch (err) {
      console.warn('[Visuals] Cast sheet failed:', noteFailure(primary, err).slice(0, 300));
    }
  }

  const shotResults = new Map<number, SceneMedia | null>();
  await mapPool(shots, CONFIG.visuals.concurrency, async (scene) => {
    const outBase = path.join(dir, `scene_${String(scene.index).padStart(2, '0')}`);
    for (const [provider, attempts] of [
      [primary, 2],
      [fallback, 1],
    ] as const) {
      if (!provider || disabled.has(provider.name)) continue;
      const useRefs = provider.supportsRefs && Boolean(sheetPath) && sceneCharacters(scene, storyboard).length > 0;
      const job: ImageJob = {
        prompt: scenePrompt(scene, storyboard, useRefs),
        refImages: useRefs ? [sheetPath!] : [],
        aspectRatio: '9:16',
        seed: baseSeed + scene.index + 1,
        outBase,
        stockQuery: scene.stockQuery,
      };
      for (let attempt = 1; attempt <= attempts && !disabled.has(provider.name); attempt++) {
        if (provider.costPerImageUsd > 0 && !withinBudget(provider.costPerImageUsd)) break;
        try {
          const media = await provider.generate(job);
          pay(`image:${provider.name}`, provider.costPerImageUsd);
          shotResults.set(scene.index, { sceneIndex: scene.index, kind: media.kind, path: media.path, provider: provider.name });
          return;
        } catch (err) {
          const message = noteFailure(provider, err);
          console.warn(`[Visuals] Scene ${scene.index} via ${provider.name} (attempt ${attempt}) failed:`, message.slice(0, 300));
        }
      }
    }
    shotResults.set(scene.index, null);
  });

  // A video made of two images repeated eleven times is worse than no video.
  const generated = shots.filter((s) => shotResults.get(s.index)).length;
  if (generated / shots.length < 0.7) {
    throw new Error(
      `Only ${generated} of ${shots.length} shots could be generated; skipping this video instead of reusing a few images everywhere.`
    );
  }

  const results: (SceneMedia | null)[] = [];
  for (const scene of scenes) {
    if (shotResults.has(scene.index)) {
      results.push(shotResults.get(scene.index)!);
    } else {
      const previous = results[results.length - 1];
      results.push(
        previous
          ? { ...previous, sceneIndex: scene.index, provider: `${previous.provider.replace(/ \(reused\)$/, '')} (reused)` }
          : null
      );
    }
  }
  const media = fillGaps(results);

  if (CONFIG.visuals.motionProvider !== 'none') {
    const motion = MOTION_PROVIDERS[CONFIG.visuals.motionProvider];
    if (!motion) throw new Error(`Unknown MOTION_PROVIDER "${CONFIG.visuals.motionProvider}"`);
    const flagged = scenes.filter((s) => s.motionCandidate);
    const targets = (flagged.length > 0 ? flagged : scenes.slice(0, 1)).slice(0, CONFIG.visuals.motionClipsPerVideo);

    for (const scene of targets) {
      const still = media[scene.index];
      if (still.kind !== 'image') continue;
      const seconds = Math.min(10, Math.max(3, (scene.endMs - scene.startMs) / 1000));
      const clipCost = motion.costPerSecondUsd * motion.billedSeconds(seconds);
      if (clipCost > 0 && !withinBudget(clipCost)) {
        console.warn(`[Visuals] Skipping motion clips: ${formatCost(clipCost)} per clip would exceed the daily budget.`);
        break;
      }
      try {
        const clip = await motion.animate({
          imagePath: still.path,
          prompt: imageSafe(scene.motionPrompt || 'Slow cinematic camera push-in with subtle natural movement.', storyboard),
          seconds,
          seed: baseSeed + 1000 + scene.index,
          outBase: path.join(dir, `motion_${String(scene.index).padStart(2, '0')}`),
        });
        media[scene.index] = { ...still, kind: 'video', path: clip, provider: `${still.provider}+${motion.name}` };
        pay(`motion:${motion.name}`, clipCost);
      } catch (err) {
        console.warn(`[Visuals] Motion for scene ${scene.index} via ${motion.name} failed; keeping the still:`, noteFailure(motion, err).slice(0, 300));
        if (disabled.has(motion.name)) break;
      }
    }
  }

  return { media, estimatedCostUsd: Number(cost.toFixed(3)) };
}

/** Scenes that failed everywhere reuse the nearest previous (or next) scene's visual. */
function fillGaps(results: (SceneMedia | null)[]): SceneMedia[] {
  if (results.every((r) => r === null)) {
    throw new Error('Every scene failed to get a visual. Check the image provider configuration.');
  }
  return results.map((r, i) => {
    if (r) return r;
    const neighbor =
      results.slice(0, i).reverse().find((x) => x !== null) || results.slice(i + 1).find((x) => x !== null)!;
    return { ...neighbor, sceneIndex: i };
  });
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
