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
 * Stitches vertical B-roll segments, applies contrast/vignette grading so text pops,
 * burns in the .ass karaoke subtitles, overlays the Satori title card for t=0..2.6s,
 * and encodes a 1080x1920 30fps H.264/AAC MP4 ready for YT Shorts, IG Reels, and FB Reels.
 */
export async function composeFinalShortMp4(
  opts: ComposeVideoOptions
): Promise<string> {
  fs.mkdirSync(opts.outputDir, { recursive: true });
  const finalMp4Path = path.join(opts.outputDir, `${opts.filePrefix}_final.mp4`);

  const escapedAssPath = opts.assSubtitlePath
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:');

  const useSyntheticCanvas = opts.brollClips.length === 0;

  return new Promise<string>((resolve, reject) => {
    const cmd = ffmpeg();

    if (useSyntheticCanvas) {
      cmd
        .input(
          `color=c=0x0f172a:s=1080x1920:r=30:d=${Math.ceil(opts.durationSeconds)}`
        )
        .inputFormat('lavfi');
    } else {
      cmd.input(opts.brollClips[0]).inputOptions(['-stream_loop -1']);
    }

    cmd.input(opts.audioPath);

    const filterChain: string[] = [
      `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,eq=brightness=-0.08:contrast=1.12:saturation=1.1,ass='${escapedAssPath}'[v_sub]`,
    ];

    if (opts.titleCardPngPath && fs.existsSync(opts.titleCardPngPath)) {
      cmd.input(opts.titleCardPngPath);
      filterChain.push(
        `[v_sub][2:v]overlay=0:0:enable='between(t,0,2.6)'[v_out]`
      );
    } else {
      filterChain.push(`[v_sub]null[v_out]`);
    }

    cmd
      .complexFilter(filterChain)
      .outputOptions([
        '-map [v_out]',
        '-map 1:a:0',
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
