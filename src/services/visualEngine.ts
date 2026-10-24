import fs from 'fs';
import path from 'path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { request } from 'undici';
import { CONFIG } from '../config.js';
import { ScriptSegment } from '../types.js';

/**
 * Renders a crisp 1080x1920 transparent PNG overlay card for the first 2.8 seconds
 * using Satori + Resvg (no headless browser required).
 */
export async function renderTitleCardPng(
  badge: string,
  headline: string,
  outputDir: string,
  filePrefix: string
): Promise<string | null> {
  const fontPath = path.join(CONFIG.paths.fontsDir, 'Inter-Bold.ttf');
  if (!fs.existsSync(fontPath)) {
    return null;
  }

  const fontData = fs.readFileSync(fontPath);
  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: '1080px',
          height: '1920px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '80px',
          backgroundColor: 'transparent',
        },
        children: [
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: 'rgba(15, 23, 42, 0.94)',
                border: '3px solid rgba(56, 189, 248, 0.7)',
                borderRadius: '36px',
                padding: '48px 56px',
                width: '920px',
                boxShadow: '0 25px 50px rgba(0,0,0,0.65)',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      backgroundColor: '#0284c7',
                      color: '#ffffff',
                      fontSize: '28px',
                      fontWeight: 700,
                      padding: '10px 24px',
                      borderRadius: '999px',
                      alignSelf: 'flex-start',
                      marginBottom: '24px',
                    },
                    children: badge.toUpperCase(),
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      color: '#f8fafc',
                      fontSize: '54px',
                      fontWeight: 700,
                      lineHeight: 1.2,
                    },
                    children: headline,
                  },
                },
              ],
            },
          },
        ],
      },
    } as any,
    {
      width: 1080,
      height: 1920,
      fonts: [
        {
          name: 'Inter',
          data: fontData,
          weight: 700,
          style: 'normal',
        },
      ],
    }
  );

  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1080 } });
  const pngBuffer = resvg.render().asPng();
  const outPath = path.join(outputDir, `${filePrefix}_card.png`);
  fs.writeFileSync(outPath, pngBuffer);
  return outPath;
}

/**
 * Resolves vertical B-roll video clips for each script segment:
 * 1. Pixabay Video API (instant free key, no waitlist/pause) if PIXABAY_API_KEY is set.
 * 2. Pexels Video API if PEXELS_API_KEY is set.
 * 3. Local B-roll files in ./assets/broll/ or ./assets/cache/ (zero API key required).
 */
export async function resolveBrollClipsForSegments(
  segments: ScriptSegment[]
): Promise<string[]> {
  fs.mkdirSync(CONFIG.paths.brollCacheDir, { recursive: true });
  fs.mkdirSync(CONFIG.paths.brollFallbackDir, { recursive: true });

  const resolvedPaths: string[] = [];
  const hasPixabay =
    Boolean(CONFIG.pixabay.apiKey) &&
    !CONFIG.pixabay.apiKey.includes('your_');
  const hasPexels =
    Boolean(CONFIG.pexels.apiKey) &&
    !CONFIG.pexels.apiKey.includes('your_');

  for (const seg of segments) {
    let clipPath: string | null = null;
    if (hasPixabay) {
      clipPath = await fetchAndCachePixabayClip(seg.pexelsSearchQuery);
    }
    if (!clipPath && hasPexels) {
      clipPath = await fetchAndCachePexelsClip(seg.pexelsSearchQuery);
    }
    if (!clipPath) {
      clipPath =
        pickRandomLocalClip(CONFIG.paths.brollFallbackDir) ||
        pickRandomLocalClip(CONFIG.paths.brollCacheDir);
    }
    if (clipPath) {
      resolvedPaths.push(clipPath);
    }
  }

  return resolvedPaths;
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
    const hits = data?.hits || [];
    for (const hit of hits) {
      const mediumUrl = hit?.videos?.medium?.url || hit?.videos?.small?.url;
      if (mediumUrl) {
        const dlRes = await request(mediumUrl);
        if (dlRes.statusCode === 200) {
          const buf = Buffer.from(await dlRes.body.arrayBuffer());
          fs.writeFileSync(cachedFile, buf);
          return cachedFile;
        }
      }
    }
  } catch (err) {
    console.warn(`[VisualEngine] Pixabay lookup failed for "${query}":`, err);
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
    const res = await request(url, {
      headers: { Authorization: CONFIG.pexels.apiKey },
    });
    if (res.statusCode !== 200) return null;

    const data = (await res.body.json()) as any;
    const videos = data?.videos || [];
    for (const v of videos) {
      const files = v.video_files || [];
      const hdPortrait =
        files.find(
          (f: any) =>
            f.file_type === 'video/mp4' &&
            f.height >= 1280 &&
            f.width <= f.height
        ) || files[0];

      if (hdPortrait?.link) {
        const dlRes = await request(hdPortrait.link);
        if (dlRes.statusCode === 200) {
          const buf = Buffer.from(await dlRes.body.arrayBuffer());
          fs.writeFileSync(cachedFile, buf);
          return cachedFile;
        }
      }
    }
  } catch (err) {
    console.warn(`[VisualEngine] Pexels lookup failed for "${query}":`, err);
  }
  return null;
}

function pickRandomLocalClip(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const mp4s = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.mp4'))
    .map((f) => path.join(dir, f));
  if (mp4s.length === 0) return null;
  return mp4s[Math.floor(Math.random() * mp4s.length)];
}
