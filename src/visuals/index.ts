import fs from 'fs';
import path from 'path';
import { CONFIG, ImageProviderName, MotionProviderName } from '../config.js';
import { SceneMedia, Storyboard, TimedScene } from '../types.js';
import { comfyImageProvider } from './images/comfyui.js';
import { falImageProvider } from './images/fal.js';
import { geminiImageProvider } from './images/gemini.js';
import { stockProvider } from './images/stock.js';
import { comfyMotionProvider } from './motion/comfyui.js';
import { falMotionProvider } from './motion/fal.js';
import { geminiMotionProvider } from './motion/gemini.js';
import { characterSheetPrompt, sceneCharacters, scenePrompt } from './prompts.js';
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
 * Produces one visual per scene:
 * 1. character reference sheets (when the provider can use references),
 * 2. scene images with the configured provider, retried once, then IMAGE_FALLBACK,
 * 3. optional AI motion clips for the hook/climax scenes (MOTION_PROVIDER).
 */
export async function generateSceneMedia(
  storyboard: Storyboard,
  scenes: TimedScene[],
  runDir: string
): Promise<VisualsResult> {
  const primary = IMAGE_PROVIDERS[CONFIG.visuals.imageProvider];
  if (!primary) throw new Error(`Unknown IMAGE_PROVIDER "${CONFIG.visuals.imageProvider}"`);
  const fallback =
    CONFIG.visuals.imageFallback !== primary.name ? IMAGE_PROVIDERS[CONFIG.visuals.imageFallback] : undefined;

  const dir = path.join(runDir, 'scenes');
  fs.mkdirSync(dir, { recursive: true });
  const baseSeed = Math.floor(Math.random() * 1_000_000_000);
  let cost = 0;

  // Quota/billing errors won't fix themselves within a run: stop calling that provider.
  const disabled = new Set<string>();
  const noteFailure = (provider: { name: string }, err: unknown) => {
    const message = (err as Error).message || String(err);
    if (/RESOURCE_EXHAUSTED|quota|limit: 0|billing|insufficient.*(credit|balance)|ECONNREFUSED/i.test(message)) {
      if (!disabled.has(provider.name)) {
        console.warn(`[Visuals] Disabling ${provider.name} for this run: ${message.split('\n')[0].slice(0, 200)}`);
      }
      disabled.add(provider.name);
    }
    return message;
  };

  const refs = new Map<string, string>();
  if (primary.supportsRefs) {
    await mapPool(storyboard.characters.slice(0, 4), CONFIG.visuals.concurrency, async (character) => {
      try {
        const sheet = await primary.generate({
          prompt: characterSheetPrompt(character, storyboard),
          refImages: [],
          aspectRatio: '1:1',
          seed: baseSeed,
          outBase: path.join(dir, `character_${character.id}`),
        });
        refs.set(character.id, sheet.path);
        cost += primary.costPerImageUsd;
      } catch (err) {
        console.warn(`[Visuals] Character sheet for ${character.name} failed:`, noteFailure(primary, err).slice(0, 300));
      }
    });
  }

  const results = await mapPool(scenes, CONFIG.visuals.concurrency, async (scene): Promise<SceneMedia | null> => {
    const sceneRefs = sceneCharacters(scene, storyboard)
      .map((c) => refs.get(c.id))
      .filter((p): p is string => Boolean(p));
    const outBase = path.join(dir, `scene_${String(scene.index).padStart(2, '0')}`);

    for (const [provider, attempts] of [
      [primary, 2],
      [fallback, 1],
    ] as const) {
      if (!provider || disabled.has(provider.name)) continue;
      const useRefs = provider.supportsRefs && sceneRefs.length > 0;
      const job: ImageJob = {
        prompt: scenePrompt(scene, storyboard, useRefs),
        refImages: useRefs ? sceneRefs : [],
        aspectRatio: '9:16',
        seed: baseSeed + scene.index + 1,
        outBase,
        stockQuery: scene.stockQuery,
      };
      for (let attempt = 1; attempt <= attempts && !disabled.has(provider.name); attempt++) {
        try {
          const media = await provider.generate(job);
          cost += provider.costPerImageUsd;
          return { sceneIndex: scene.index, kind: media.kind, path: media.path, provider: provider.name };
        } catch (err) {
          const message = noteFailure(provider, err);
          console.warn(`[Visuals] Scene ${scene.index} via ${provider.name} (attempt ${attempt}) failed:`, message.slice(0, 300));
        }
      }
    }
    return null;
  });

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
      try {
        const clip = await motion.animate({
          imagePath: still.path,
          prompt: scene.motionPrompt || 'Slow cinematic camera push-in with subtle natural movement.',
          seconds,
          seed: baseSeed + 1000 + scene.index,
          outBase: path.join(dir, `motion_${String(scene.index).padStart(2, '0')}`),
        });
        media[scene.index] = { ...still, kind: 'video', path: clip, provider: `${still.provider}+${motion.name}` };
        cost += motion.costPerSecondUsd * Math.max(5, Math.ceil(seconds));
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
