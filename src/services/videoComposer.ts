import { execFile } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';

export interface ComposeVideoOptions {
  brollClips: string[];
  audioPath: string;
  assSubtitlePath: string;
  titleCardPngPath: string | null;
  durationSeconds: number;
  outputDir: string;
  filePrefix: string;
}

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
 * Stitches vertical B-roll segments, applies contrast/vignette grading so text pops,
 * burns in the .ass karaoke subtitles, overlays the Satori title card for t=0..2.6s,
 * and encodes a 1080x1920 30fps H.264/AAC MP4 ready for YT Shorts, IG Reels, and FB Reels.
 */
export async function composeFinalShortMp4(
  opts: ComposeVideoOptions
): Promise<string> {
  await assertLibassAvailable();
  fs.mkdirSync(opts.outputDir, { recursive: true });
  const finalMp4Path = path.join(opts.outputDir, `${opts.filePrefix}_final.mp4`);

  const escapedAssPath = opts.assSubtitlePath
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:');

  const useSyntheticCanvas = opts.brollClips.length === 0;

  return new Promise<string>((resolve, reject) => {
    const cmd = ffmpeg();

    // The synthetic canvas is a `color` source inside the filtergraph rather than a
    // `-f lavfi` input: fluent-ffmpeg's format check can't parse ffmpeg 8+'s device
    // formats list and rejects lavfi as unavailable.
    let videoSource = '[0:v]';
    if (useSyntheticCanvas) {
      videoSource = `color=c=0x0f172a:s=1080x1920:r=30:d=${Math.ceil(opts.durationSeconds)},`;
    } else {
      cmd.input(opts.brollClips[0]).inputOptions(['-stream_loop -1']);
    }

    const audioInputIndex = useSyntheticCanvas ? 0 : 1;
    cmd.input(opts.audioPath);

    const filterChain: string[] = [
      `${videoSource}scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,eq=brightness=-0.08:contrast=1.12:saturation=1.1,ass='${escapedAssPath}'[v_sub]`,
    ];

    if (opts.titleCardPngPath && fs.existsSync(opts.titleCardPngPath)) {
      cmd.input(opts.titleCardPngPath);
      filterChain.push(
        `[v_sub][${audioInputIndex + 1}:v]overlay=0:0:enable='between(t,0,2.6)'[v_out]`
      );
    } else {
      filterChain.push(`[v_sub]null[v_out]`);
    }

    cmd
      .complexFilter(filterChain)
      .outputOptions([
        '-map [v_out]',
        `-map ${audioInputIndex}:a:0`,
        `-t ${opts.durationSeconds.toFixed(2)}`,
        '-c:v libx264',
        '-preset veryfast',
        '-crf 21',
        '-pix_fmt yuv420p',
        '-c:a aac',
        '-b:a 192k',
        '-movflags +faststart',
      ])
      .save(finalMp4Path)
      .on('end', () => resolve(finalMp4Path))
      .on('error', (err) => reject(err));
  });
}
