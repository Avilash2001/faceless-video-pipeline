import fs from 'fs';
import path from 'path';
import { request } from 'undici';
import { CONFIG } from '../../config.js';
import { GeneratedMedia, ImageJob, ImageProvider } from '../types.js';

/**
 * Stock B-roll fallback: Pixabay (if PIXABAY_API_KEY), then Pexels (if PEXELS_API_KEY),
 * then a random clip from ./assets/broll or ./assets/cache. Returns a video, not a still.
 */
export const stockProvider: ImageProvider = {
  name: 'stock',
  costPerImageUsd: 0,
  supportsRefs: false,
  async generate(job: ImageJob): Promise<GeneratedMedia> {
    fs.mkdirSync(CONFIG.paths.brollCacheDir, { recursive: true });
    const query = job.stockQuery || job.prompt.split(/\s+/).slice(0, 4).join(' ');
    const clip =
      (isRealKey(CONFIG.pixabay.apiKey) ? await fetchAndCachePixabayClip(query) : null) ||
      (isRealKey(CONFIG.pexels.apiKey) ? await fetchAndCachePexelsClip(query) : null) ||
      pickRandomLocalClip(CONFIG.paths.brollFallbackDir) ||
      pickRandomLocalClip(CONFIG.paths.brollCacheDir);
    if (!clip) throw new Error(`No stock clip found for "${query}" and no local B-roll available.`);
    return { path: clip, kind: 'video' };
  },
};

function isRealKey(key: string): boolean {
  return Boolean(key) && !key.includes('your_');
}

async function fetchAndCachePixabayClip(query: string): Promise<string | null> {
  const slug = `px_${query.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`;
  const cachedFile = path.join(CONFIG.paths.brollCacheDir, `${slug}.mp4`);
  if (fs.existsSync(cachedFile)) return cachedFile;

  try {
    const url = `https://pixabay.com/api/videos/?key=${encodeURIComponent(
      CONFIG.pixabay.apiKey
    )}&q=${encodeURIComponent(query)}&per_page=5&safesearch=true`;
    const res = await request(url);
    if (res.statusCode !== 200) return null;

    const data = (await res.body.json()) as any;
    for (const hit of data?.hits || []) {
      const mediumUrl = hit?.videos?.medium?.url || hit?.videos?.small?.url;
      if (mediumUrl) {
        const dlRes = await request(mediumUrl);
        if (dlRes.statusCode === 200) {
          fs.writeFileSync(cachedFile, Buffer.from(await dlRes.body.arrayBuffer()));
          return cachedFile;
        }
      }
    }
  } catch (err) {
    console.warn(`[Stock] Pixabay lookup failed for "${query}":`, err);
  }
  return null;
}

async function fetchAndCachePexelsClip(query: string): Promise<string | null> {
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
  const cachedFile = path.join(CONFIG.paths.brollCacheDir, `${slug}.mp4`);
  if (fs.existsSync(cachedFile)) return cachedFile;

  try {
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(
      query
    )}&orientation=portrait&size=medium&per_page=4`;
    const res = await request(url, { headers: { Authorization: CONFIG.pexels.apiKey } });
    if (res.statusCode !== 200) return null;

    const data = (await res.body.json()) as any;
    for (const v of data?.videos || []) {
      const files = v.video_files || [];
      const hdPortrait =
        files.find((f: any) => f.file_type === 'video/mp4' && f.height >= 1280 && f.width <= f.height) || files[0];
      if (hdPortrait?.link) {
        const dlRes = await request(hdPortrait.link);
        if (dlRes.statusCode === 200) {
          fs.writeFileSync(cachedFile, Buffer.from(await dlRes.body.arrayBuffer()));
          return cachedFile;
        }
      }
    }
  } catch (err) {
    console.warn(`[Stock] Pexels lookup failed for "${query}":`, err);
  }
  return null;
}

function pickRandomLocalClip(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const mp4s = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.mp4'))
    .map((f) => path.join(dir, f));
  return mp4s.length === 0 ? null : mp4s[Math.floor(Math.random() * mp4s.length)];
}
