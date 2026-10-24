import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export type ImageProviderName = 'gemini' | 'comfyui' | 'fal' | 'stock';
export type MotionProviderName = 'none' | 'gemini' | 'fal' | 'comfyui';
export type RedditAccessMode = 'api' | 'inbox' | 'rss';

export const CONFIG = {
  paths: {
    root: process.cwd(),
    dataDir: path.join(process.cwd(), 'data'),
    dbFile: path.join(process.cwd(), 'data', 'pipeline.sqlite'),
    strategyFile: path.join(process.cwd(), 'data', 'strategy_rules.json'),
    storyInboxDir: path.join(process.cwd(), 'data', 'story_inbox'),
    assetsDir: path.join(process.cwd(), 'assets'),
    brollFallbackDir: path.join(process.cwd(), 'assets', 'broll'),
    brollCacheDir: path.join(process.cwd(), 'assets', 'cache'),
    sfxDir: path.join(process.cwd(), 'assets', 'sfx'),
    fontsDir: path.join(process.cwd(), 'assets', 'fonts'),
    comfyWorkflowsDir: path.join(process.cwd(), 'assets', 'comfy'),
    outputDir: path.join(process.cwd(), 'output'),
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    imageModel: process.env.GEMINI_IMAGE_MODEL || 'gemini-nano-banana-2.1',
    /** 1K | 2K | 4K. 2K leaves headroom for pan/zoom above 1080x1920. */
    imageSize: process.env.GEMINI_IMAGE_SIZE || '2K',
    videoModel: process.env.GEMINI_VIDEO_MODEL || 'gemini-omni-1.1-flash',
  },
  visuals: {
    imageProvider: (process.env.IMAGE_PROVIDER || 'gemini') as ImageProviderName,
    imageFallback: (process.env.IMAGE_FALLBACK || 'stock') as ImageProviderName,
    motionProvider: (process.env.MOTION_PROVIDER || 'none') as MotionProviderName,
    motionClipsPerVideo: Number(process.env.MOTION_CLIPS_PER_VIDEO || 2),
    concurrency: Number(process.env.IMAGE_CONCURRENCY || 3),
  },
  comfyui: {
    url: process.env.COMFYUI_URL || 'http://127.0.0.1:8188',
    /** API-format workflow exports in assets/comfy/ (see README). */
    imageWorkflow: process.env.COMFYUI_IMAGE_WORKFLOW || 'image_t2i.json',
    /** Optional reference-image edit workflow used for scenes with recurring characters. */
    imageEditWorkflow: process.env.COMFYUI_IMAGE_EDIT_WORKFLOW || 'image_edit.json',
    videoWorkflow: process.env.COMFYUI_VIDEO_WORKFLOW || 'video_i2v.json',
    imageWidth: Number(process.env.COMFYUI_IMAGE_WIDTH || 896),
    imageHeight: Number(process.env.COMFYUI_IMAGE_HEIGHT || 1600),
    videoWidth: Number(process.env.COMFYUI_VIDEO_WIDTH || 480),
    videoHeight: Number(process.env.COMFYUI_VIDEO_HEIGHT || 832),
    videoFps: Number(process.env.COMFYUI_VIDEO_FPS || 16),
    timeoutMs: Number(process.env.COMFYUI_TIMEOUT_MS || 20 * 60 * 1000),
  },
  fal: {
    apiKey: process.env.FAL_KEY || '',
    imageModel: process.env.FAL_IMAGE_MODEL || 'fal-ai/bytedance/seedream/v5/lite/text-to-image',
    /** Reference-image edit endpoint for scenes with recurring characters. */
    imageEditModel: process.env.FAL_IMAGE_EDIT_MODEL || 'fal-ai/bytedance/seedream/v5/lite/edit',
    imageCostUsd: Number(process.env.FAL_IMAGE_COST_USD || 0.035),
    videoModel: process.env.FAL_VIDEO_MODEL || 'fal-ai/kling-video/v2.5-turbo/standard/image-to-video',
    videoCostPerSecondUsd: Number(process.env.FAL_VIDEO_COST_PER_SECOND_USD || 0.042),
  },
  reddit: {
    access: (process.env.REDDIT_ACCESS || 'inbox') as RedditAccessMode,
    clientId: process.env.REDDIT_CLIENT_ID || '',
    clientSecret: process.env.REDDIT_CLIENT_SECRET || '',
    userAgent: process.env.REDDIT_USER_AGENT || 'node:faceless-video-pipeline:v2.0.0',
  },
  audio: {
    musicDir: process.env.MUSIC_DIR || path.join(process.cwd(), 'assets', 'music'),
    /** Music bed level relative to the voice, before ducking. */
    musicVolume: Number(process.env.MUSIC_VOLUME || 0.18),
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
    privacy: process.env.YOUTUBE_PRIVACY || 'public',
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
