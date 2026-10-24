import { CONFIG } from '../../config.js';
import { downloadTo, falRun, toDataUri } from '../falClient.js';
import { MotionJob, MotionProvider } from '../types.js';

/** fal.ai image-to-video (default Kling 2.5 Turbo Standard, 5 or 10 second clips). */
export const falMotionProvider: MotionProvider = {
  name: 'fal',
  costPerSecondUsd: CONFIG.fal.videoCostPerSecondUsd,
  async animate(job: MotionJob): Promise<string> {
    const result = await falRun(CONFIG.fal.videoModel, {
      prompt: `${job.prompt} Keep the art style and characters of the image.`,
      image_url: toDataUri(job.imagePath),
      duration: job.seconds > 7 ? '10' : '5',
      negative_prompt: 'blur, distortion, low quality, text, watermark',
    });
    const url = result?.video?.url;
    if (!url) throw new Error(`fal returned no video: ${JSON.stringify(result).slice(0, 300)}`);
    return downloadTo(url, `${job.outBase}.mp4`);
  },
};
