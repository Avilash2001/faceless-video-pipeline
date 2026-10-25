import fs from 'fs';
import { CONFIG } from '../../config.js';
import { ai } from '../../services/gemini.js';
import { imagePriceUsd } from '../../spend.js';
import { GeneratedMedia, ImageJob, ImageProvider } from '../types.js';

/** Nano Banana (Gemini native image generation) on the existing GEMINI_API_KEY. */
export const geminiImageProvider: ImageProvider = {
  name: 'gemini',
  costPerImageUsd: imagePriceUsd('gemini', CONFIG),
  supportsRefs: true,
  async generate(job: ImageJob): Promise<GeneratedMedia> {
    const parts: { inlineData?: { mimeType: string; data: string }; text?: string }[] = job.refImages.map((p) => ({
      inlineData: {
        mimeType: /\.jpe?g$/i.test(p) ? 'image/jpeg' : 'image/png',
        data: fs.readFileSync(p).toString('base64'),
      },
    }));
    parts.push({ text: job.prompt });

    const res = await ai.models.generateContent({
      model: CONFIG.gemini.imageModel,
      contents: [{ role: 'user', parts }],
      config: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: job.aspectRatio, imageSize: CONFIG.gemini.imageSize },
      },
    });

    const image = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!image?.data) {
      throw new Error(
        `Gemini returned no image (finishReason: ${res.candidates?.[0]?.finishReason ?? 'none'}${
          res.promptFeedback?.blockReason ? `, blocked: ${res.promptFeedback.blockReason}` : ''
        })`
      );
    }
    const outPath = `${job.outBase}${image.mimeType === 'image/jpeg' ? '.jpg' : '.png'}`;
    fs.writeFileSync(outPath, Buffer.from(image.data, 'base64'));
    return { path: outPath, kind: 'image' };
  },
};
