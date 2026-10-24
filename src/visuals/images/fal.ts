import { CONFIG } from '../../config.js';
import { downloadTo, falRun, toDataUri } from '../falClient.js';
import { GeneratedMedia, ImageJob, ImageProvider } from '../types.js';

/** fal.ai image models (default Seedream 5 Lite; edit endpoint when references are attached). */
export const falImageProvider: ImageProvider = {
  name: 'fal',
  costPerImageUsd: CONFIG.fal.imageCostUsd,
  supportsRefs: Boolean(CONFIG.fal.imageEditModel),
  async generate(job: ImageJob): Promise<GeneratedMedia> {
    const useEdit = job.refImages.length > 0 && Boolean(CONFIG.fal.imageEditModel);
    const result = await falRun(useEdit ? CONFIG.fal.imageEditModel : CONFIG.fal.imageModel, {
      prompt: job.prompt,
      image_size: { '9:16': 'portrait_16_9', '1:1': 'square_hd', '16:9': 'landscape_16_9' }[job.aspectRatio],
      num_images: 1,
      output_format: 'png',
      ...(useEdit ? { image_urls: job.refImages.map(toDataUri) } : { seed: job.seed }),
    });
    const url = result?.images?.[0]?.url;
    if (!url) throw new Error(`fal returned no image: ${JSON.stringify(result).slice(0, 300)}`);
    return { path: await downloadTo(url, `${job.outBase}.png`), kind: 'image' };
  },
};
