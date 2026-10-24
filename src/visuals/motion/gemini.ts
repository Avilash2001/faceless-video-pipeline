import fs from 'fs';
import { CONFIG } from '../../config.js';
import { ai } from '../../services/gemini.js';
import { MotionJob, MotionProvider } from '../types.js';

/** Gemini Omni Flash image-to-video on the existing GEMINI_API_KEY (~$0.10/s at 720p). */
export const geminiMotionProvider: MotionProvider = {
  name: 'gemini',
  costPerSecondUsd: 0.1,
  async animate(job: MotionJob): Promise<string> {
    const mime = /\.jpe?g$/i.test(job.imagePath) ? 'image/jpeg' : 'image/png';
    const interaction = await ai.interactions.create({
      model: CONFIG.gemini.videoModel,
      input: [
        { type: 'image', data: fs.readFileSync(job.imagePath).toString('base64'), mime_type: mime },
        {
          type: 'text',
          text: `${job.prompt} Keep the exact art style, characters and composition of the image. No dialogue, no on-screen text.`,
        },
      ],
      response_format: {
        type: 'video',
        aspect_ratio: '9:16',
        resolution: '720p',
        duration: `${Math.round(job.seconds)}s`,
      },
    } as Parameters<typeof ai.interactions.create>[0]);

    const data = (interaction as { output_video?: { data?: string } }).output_video?.data;
    if (!data) throw new Error('Gemini Omni returned no video.');
    const outPath = `${job.outBase}.mp4`;
    fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
    return outPath;
  },
};
