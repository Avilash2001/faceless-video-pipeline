import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';
import { formatCost, recordSpend, withinBudget } from '../services/costs.js';
import { ai } from '../services/gemini.js';
import { MusicMood } from '../types.js';

/**
 * Builds a reusable background-music library with Lyria: one ~2 minute instrumental per mood
 * in assets/music/<mood>/. Run once ($0.08 per track); every video then picks a random section
 * of its mood's track, so music costs nothing per video.
 *   npm run make-music                      # 1 track per mood, skips moods that already have one
 *   npm run make-music -- --per-mood 2 --moods tense,dark
 */

const MOOD_PROMPTS: Record<MusicMood, string> = {
  tense: 'tense cinematic underscore, pulsing low synth ostinato, ticking percussion, slow build, 95 BPM',
  mysterious: 'mysterious ambient underscore, soft piano motifs, airy pads, subtle music-box textures, 80 BPM',
  upbeat: 'light upbeat underscore, plucky guitar and marimba, claps, warm and optimistic, 110 BPM',
  emotional: 'emotional cinematic underscore, gentle piano and soft strings, hopeful and bittersweet, 70 BPM',
  dark: 'dark brooding underscore, deep cello drones, sparse low percussion, ominous atmosphere, 75 BPM',
  playful: 'playful comedic underscore, pizzicato strings, bassoon, light percussion, mischievous, 105 BPM',
};

const PRICE_PER_TRACK_USD = 0.08;

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const perMood = Number(argValue('per-mood') || 1);
  const moods = (argValue('moods')?.split(',') || Object.keys(MOOD_PROMPTS)) as MusicMood[];

  for (const mood of moods) {
    const dir = path.join(CONFIG.audio.musicDir, mood);
    fs.mkdirSync(dir, { recursive: true });
    const existing = fs.readdirSync(dir).filter((f) => /\.(mp3|wav|m4a)$/i.test(f)).length;
    for (let n = existing; n < perMood; n++) {
      if (!withinBudget(PRICE_PER_TRACK_USD)) {
        console.warn(`[Music] Stopping: another track would exceed DAILY_BUDGET_USD ($${CONFIG.costs.dailyBudgetUsd}).`);
        return;
      }
      const prompt =
        `Background score for a narrated short-form story video: ${MOOD_PROMPTS[mood]}. ` +
        'Instrumental only, no vocals, no lyrics. Consistent energy with no sudden drops or loud hits, ' +
        'mixed to sit quietly under a voice. About 2 minutes.';
      const interaction = await ai.interactions.create({ model: CONFIG.gemini.musicModel, input: prompt } as Parameters<
        typeof ai.interactions.create
      >[0]);
      const audio = (interaction as { output_audio?: { data?: string } }).output_audio?.data;
      if (!audio) throw new Error(`Lyria returned no audio for "${mood}".`);
      const file = path.join(dir, `lyria_${mood}_${Date.now()}.mp3`);
      fs.writeFileSync(file, Buffer.from(audio, 'base64'));
      recordSpend(`music:${CONFIG.gemini.musicModel}`, PRICE_PER_TRACK_USD);
      console.log(`[Music] ${mood}: wrote ${file} (${formatCost(PRICE_PER_TRACK_USD)})`);
    }
  }
}

main().catch((err) => {
  console.error('[Music] Failed:', err.message || err);
  process.exit(1);
});
