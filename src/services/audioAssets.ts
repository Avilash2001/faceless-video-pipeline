import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';
import { MusicMood, SfxCue, TimedScene } from '../types.js';
import { SfxEvent } from './videoComposer.js';

const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|aac)$/i;

function audioFilesIn(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => AUDIO_EXT.test(f))
    .map((f) => path.join(dir, f));
}

/** A random track from MUSIC_DIR/<mood>/, else from MUSIC_DIR itself, else none. */
export function pickMusicTrack(mood: MusicMood): string | null {
  const tracks = audioFilesIn(path.join(CONFIG.audio.musicDir, mood));
  const pool = tracks.length > 0 ? tracks : audioFilesIn(CONFIG.audio.musicDir);
  return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
}

function sfxFile(cue: Exclude<SfxCue, 'none'>): string | null {
  return audioFilesIn(CONFIG.paths.sfxDir).find((f) => path.parse(f).name.toLowerCase() === cue) || null;
}

/**
 * SFX hits from assets/sfx/{whoosh,impact,riser}.(mp3|wav|...): whooshes and impacts land on
 * the scene cut; risers start ~1.2s before it so they peak on the cut. Missing files are skipped.
 */
export function buildSfxEvents(scenes: TimedScene[]): SfxEvent[] {
  const events: SfxEvent[] = [];
  for (const scene of scenes) {
    if (scene.sfx === 'none' || scene.index === 0) continue;
    const file = sfxFile(scene.sfx);
    if (!file) continue;
    const atMs = scene.sfx === 'riser' ? scene.startMs - 1200 : scene.startMs - 60;
    events.push({ atMs: Math.max(0, atMs), path: file });
  }
  return events;
}
