import fs from 'fs';
import { CONFIG } from '../../config.js';
import { imagePriceUsd } from '../../spend.js';
import { resolveWorkflowPath, runComfyWorkflow } from '../comfyClient.js';
import { GeneratedMedia, ImageJob, ImageProvider } from '../types.js';

/**
 * Local generation through a ComfyUI server (e.g. FLUX.2 klein 4B on an RTX 3060).
 * Scenes with characters use the reference-image edit workflow when it exists.
 */
export const comfyImageProvider: ImageProvider = {
  name: 'comfyui',
  costPerImageUsd: imagePriceUsd('comfyui', CONFIG),
  supportsRefs: fs.existsSync(resolveWorkflowPath(CONFIG.comfyui.imageEditWorkflow)),
  async generate(job: ImageJob): Promise<GeneratedMedia> {
    const useEdit = job.refImages.length > 0 && this.supportsRefs;
    const { imageWidth: w, imageHeight: h } = CONFIG.comfyui;
    const size = { '9:16': [w, h], '1:1': [w, w], '16:9': [h, w] }[job.aspectRatio];
    const { data, ext } = await runComfyWorkflow(
      useEdit ? CONFIG.comfyui.imageEditWorkflow : CONFIG.comfyui.imageWorkflow,
      {
        prompt: job.prompt,
        negative: 'text, letters, watermark, logo, blurry, deformed hands, extra fingers',
        seed: job.seed,
        width: size[0],
        height: size[1],
        images: useEdit ? job.refImages : [],
      },
      'image'
    );
    const outPath = `${job.outBase}${ext}`;
    fs.writeFileSync(outPath, data);
    return { path: outPath, kind: 'image' };
  },
};
