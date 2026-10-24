import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const CONFIG = {
  paths: {
    root: process.cwd(),
    dataDir: path.join(process.cwd(), 'data'),
    dbFile: path.join(process.cwd(), 'data', 'pipeline.sqlite'),
    strategyFile: path.join(process.cwd(), 'data', 'strategy_rules.json'),
    assetsDir: path.join(process.cwd(), 'assets'),
    brollFallbackDir: path.join(process.cwd(), 'assets', 'broll'),
    brollCacheDir: path.join(process.cwd(), 'assets', 'cache'),
    sfxDir: path.join(process.cwd(), 'assets', 'sfx'),
    fontsDir: path.join(process.cwd(), 'assets', 'fonts'),
    outputDir: path.join(process.cwd(), 'output'),
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },
  pixabay: {
    apiKey: process.env.PIXABAY_API_KEY || '',
  },
  pexels: {
    apiKey: process.env.PEXELS_API_KEY || '',
  },
  youtube: {
    clientId: process.env.YOUTUBE_CLIENT_ID || '',
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
    refreshToken: process.env.YOUTUBE_REFRESH_TOKEN || '',
  },
  meta: {
    accessToken: process.env.META_ACCESS_TOKEN || '',
    igBusinessId: process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || '',
    fbPageId: process.env.FACEBOOK_PAGE_ID || '',
    publicVideoBaseUrl: process.env.PUBLIC_VIDEO_BASE_URL || '',
  },
  schedule: {
    generate: process.env.CRON_GENERATE_SCHEDULE || '0 8,18 * * *',
    metrics: process.env.CRON_METRICS_SCHEDULE || '0 2 * * *',
    evolve: process.env.CRON_EVOLVE_SCHEDULE || '0 4 * * 0',
    enableAutoUpload: process.env.ENABLE_AUTO_UPLOAD === 'true',
  },
};
