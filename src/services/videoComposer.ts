import { execFile } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';
import { CameraMove, SceneMedia, TimedScene } from '../types.js';

export interface SfxEvent {
  atMs: number;
  path: string;
}

export interface ComposeVideoOptions {
  scenes: TimedScene[];
  media: SceneMedia[];
  audioPath: string;
  assSubtitlePath: string;
  durationSeconds: number;
  outputDir: string;
  filePrefix: string;
  musicPath?: string | null;
  sfx?: SfxEvent[];
}

const FPS = 30;
const AUDIO_FORMAT = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';

/**
 * Fails fast with a fix-it message when ffmpeg can't burn in .ass subtitles.
 * Homebrew's core `ffmpeg` formula is built without libass; `ffmpeg-full` has it.
 * Probes ffmpeg directly: fluent-ffmpeg's getAvailableFilters() can't parse ffmpeg 8+ output.
 */
async function assertLibassAvailable(): Promise<void> {
  // Same resolution order fluent-ffmpeg uses: FFMPEG_PATH if it exists, else PATH.
  const envPath = process.env.FFMPEG_PATH;
  const binary = envPath && fs.existsSync(envPath) ? envPath : 'ffmpeg';
  const output = await new Promise<string>((resolve) =>
    execFile(binary, ['-hide_banner', '-h', 'filter=ass'], (_err, stdout, stderr) =>
      resolve(`${stdout}${stderr}`)
    )
  );
  if (!output.includes('Filter ass')) {
    throw new Error(
      `ffmpeg (${binary}) can't burn in karaoke subtitles: ${output.trim().split('\n')[0] || 'no output'}. ` +
        'It needs libass. On macOS: `brew install ffmpeg-full`, then set FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg in .env.'
    );
  }
}

/**
 * Pan/zoom over a still. The input is pre-scaled to 2160x3840 so zoompan's whole-pixel
 * steps are half-pixels at output size, which keeps slow moves from jittering.
 */
function kenBurns(camera: CameraMove, frames: number): string {
  const p = `on/${Math.max(1, frames - 1)}`;
  const zoom = 1.15;
  const cx = `x='iw/2-(iw/zoom/2)'`;
  const cy = `y='ih/2-(ih/zoom/2)'`;
  const moves: Record<CameraMove, string> = {
    push_in: `z='1+${(zoom - 1).toFixed(2)}*${p}':${cx}:${cy}`,
    pull_out: `z='${zoom}-${(zoom - 1).toFixed(2)}*${p}':${cx}:${cy}`,
    pan_left: `z='${zoom}':x='(iw-iw/zoom)*(1-${p})':${cy}`,
    pan_right: `z='${zoom}':x='(iw-iw/zoom)*${p}':${cy}`,
    pan_up: `z='${zoom}':${cx}:y='(ih-ih/zoom)*(1-${p})'`,
    pan_down: `z='${zoom}':${cx}:y='(ih-ih/zoom)*${p}'`,
  };
  return `scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840,zoompan=${moves[camera]}:d=${frames}:s=1080x1920:fps=${FPS}`;
}

/**
 * Builds the vertical short: one visual per scene cut exactly on the scene's narration
 * timing (stills get a pan/zoom, clips are scaled and trimmed), karaoke captions burned in,
 * and the voice mixed with an optional ducked music bed and SFX hits.
 * Encodes 1080x1920 30fps H.264/AAC for YT Shorts, IG Reels, and FB Reels.
 */
export async function composeFinalShortMp4(opts: ComposeVideoOptions): Promise<string> {
  await assertLibassAvailable();
  fs.mkdirSync(opts.outputDir, { recursive: true });
  const finalMp4Path = path.join(opts.outputDir, `${opts.filePrefix}_final.mp4`);
  const escapedAssPath = opts.assSubtitlePath.replace(/\\/g, '/').replace(/:/g, '\\:');

  const totalFrames = Math.round(opts.durationSeconds * FPS);
  const bounds = opts.scenes.map((s) => Math.min(totalFrames - 1, Math.round((s.startMs / 1000) * FPS)));
  bounds.push(totalFrames);

  return new Promise<string>((resolve, reject) => {
    const cmd = ffmpeg();
    const filters: string[] = [];
    let inputIndex = 0;

    opts.scenes.forEach((scene, i) => {
      const frames = Math.max(1, bounds[i + 1] - bounds[i]);
      const media = opts.media[i];
      if (media.kind === 'image') {
        cmd.input(media.path);
        filters.push(`[${inputIndex}:v]${kenBurns(scene.camera, frames)},setsar=1,format=yuv420p[s${i}]`);
      } else {
        cmd.input(media.path).inputOptions(['-stream_loop -1']);
        filters.push(
          `[${inputIndex}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=${FPS},setsar=1,format=yuv420p,trim=end_frame=${frames},setpts=PTS-STARTPTS[s${i}]`
        );
      }
      inputIndex++;
    });

    filters.push(
      `${opts.scenes.map((_, i) => `[s${i}]`).join('')}concat=n=${opts.scenes.length}:v=1:a=0,ass='${escapedAssPath}'[vout]`
    );

    const voiceIndex = inputIndex++;
    cmd.input(opts.audioPath);

    const mixInputs: string[] = [];
    let audioMap = `${voiceIndex}:a:0`;
    const sfx = (opts.sfx || []).filter((e) => fs.existsSync(e.path));

    if (opts.musicPath || sfx.length > 0) {
      if (opts.musicPath) {
        filters.push(`[${voiceIndex}:a]${AUDIO_FORMAT},asplit=2[voice][vkey]`);
        const musicIndex = inputIndex++;
        cmd.input(opts.musicPath).inputOptions(['-stream_loop -1']);
        filters.push(
          `[${musicIndex}:a]${AUDIO_FORMAT},volume=${CONFIG.audio.musicVolume}[mbed]`,
          `[mbed][vkey]sidechaincompress=threshold=0.04:ratio=10:attack=15:release=350[music]`
        );
        mixInputs.push('[voice]', '[music]');
      } else {
        filters.push(`[${voiceIndex}:a]${AUDIO_FORMAT}[voice]`);
        mixInputs.push('[voice]');
      }

      sfx.forEach((event, i) => {
        const sfxIndex = inputIndex++;
        const delay = Math.max(0, Math.round(event.atMs));
        cmd.input(event.path);
        filters.push(`[${sfxIndex}:a]${AUDIO_FORMAT},volume=0.5,adelay=${delay}|${delay}[fx${i}]`);
        mixInputs.push(`[fx${i}]`);
      });

      filters.push(
        `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0:normalize=0[aout]`
      );
      audioMap = '[aout]';
    }

    cmd
      .complexFilter(filters)
      .outputOptions([
        '-map [vout]',
        `-map ${audioMap}`,
        `-t ${opts.durationSeconds.toFixed(2)}`,
        `-r ${FPS}`,
        '-c:v libx264',
        '-preset veryfast',
        '-crf 20',
        '-pix_fmt yuv420p',
        '-c:a aac',
        '-b:a 192k',
        '-movflags +faststart',
      ])
      .save(finalMp4Path)
      .on('end', () => resolve(finalMp4Path))
      .on('error', (err, _stdout, stderr) =>
        reject(new Error(`${err.message}\n${(stderr || '').split('\n').slice(-8).join('\n')}`))
      );
  });
}
