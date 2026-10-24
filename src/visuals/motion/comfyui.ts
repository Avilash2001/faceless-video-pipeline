import fs from 'fs';
import { CONFIG } from '../../config.js';
import { runComfyWorkflow } from '../comfyClient.js';
import { MotionJob, MotionProvider } from '../types.js';

/** Local image-to-video through ComfyUI (e.g. Wan 2.2 I2V with the 4-step LoRA on an RTX 3060). */
export const comfyMotionProvider: MotionProvider = {
  name: 'comfyui',
  costPerSecondUsd: 0,
  billedSeconds: (seconds) => seconds,
  async animate(job: MotionJob): Promise<string> {
    // Wan expects 4n+1 frames.
    const frames = Math.round((job.seconds * CONFIG.comfyui.videoFps) / 4) * 4 + 1;
    const { data, ext } = await runComfyWorkflow(
      CONFIG.comfyui.videoWorkflow,
      {
        prompt: `${job.prompt} Consistent art style, smooth natural motion.`,
        negative: 'static, blurry, distorted, text, watermark, extra limbs',
        seed: job.seed,
        width: CONFIG.comfyui.videoWidth,
        height: CONFIG.comfyui.videoHeight,
        images: [job.imagePath],
        frames,
      },
      'video'
    );
    const outPath = `${job.outBase}${ext}`;
    fs.writeFileSync(outPath, data);
    return outPath;
  },
};
