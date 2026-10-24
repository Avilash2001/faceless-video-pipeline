import path from 'path';

export type ImageProviderName = 'gemini' | 'comfyui' | 'fal' | 'stock';
export type MotionProviderName = 'none' | 'gemini' | 'fal' | 'comfyui';
export type RedditAccessMode = 'api' | 'inbox' | 'rss';

export type Config = ReturnType<typeof loadConfig>;

/** Builds the config from an environment, with every path under `root`. */
export function loadConfig(env: NodeJS.ProcessEnv, root: string) {
  return {
    paths: {
      root,
      dataDir: path.join(root, 'data'),
      dbFile: path.join(root, 'data', 'pipeline.sqlite'),
      strategyFile: path.join(root, 'data', 'strategy_rules.json'),
      storyInboxDir: path.join(root, 'data', 'story_inbox'),
      assetsDir: path.join(root, 'assets'),
      brollFallbackDir: path.join(root, 'assets', 'broll'),
      brollCacheDir: path.join(root, 'assets', 'cache'),
      sfxDir: path.join(root, 'assets', 'sfx'),
      fontsDir: path.join(root, 'assets', 'fonts'),
      comfyWorkflowsDir: path.join(root, 'assets', 'comfy'),
      outputDir: path.join(root, 'output'),
    },
    gemini: {
      apiKey: env.GEMINI_API_KEY || '',
      /** Writes the storyboard (the creative step). */
      model: env.GEMINI_MODEL || 'gemini-3.8-flash',
      /** Picks and briefs the story; a cheaper model is plenty here. */
      editorModel: env.GEMINI_EDITOR_MODEL || 'gemini-3.1-flash-lite',
      /** minimal | low | medium | high. Thinking tokens are billed as output. */
      thinking: (env.GEMINI_THINKING || 'low').toUpperCase(),
      imageModel: env.GEMINI_IMAGE_MODEL || 'gemini-nano-banana-2.1',
      /** 1K ($0.034) | 2K ($0.050) | 4K. 1K is upscaled for pan/zoom; 2K is sharper. */
      imageSize: env.GEMINI_IMAGE_SIZE || '1K',
      videoModel: env.GEMINI_VIDEO_MODEL || 'gemini-omni-1.1-flash',
      musicModel: env.GEMINI_MUSIC_MODEL || 'lyria-3.5',
    },
    costs: {
      /** The Daily budget: the most paid Providers may cost per UTC day; paid work past it is skipped. */
      dailyBudgetUsd: Number(env.DAILY_BUDGET_USD || 0.5),
      /** Display only: converts logged USD estimates to INR including GST. */
      usdToInr: Number(env.USD_TO_INR || 88),
      taxMultiplier: Number(env.COST_TAX_MULTIPLIER || 1.18),
    },
    visuals: {
      imageProvider: (env.IMAGE_PROVIDER || 'gemini') as ImageProviderName,
      /** Per-scene fallback; 'none' reuses a neighbouring scene's image instead (keeps one art style). */
      imageFallback: (env.IMAGE_FALLBACK || 'none') as ImageProviderName | 'none',
      motionProvider: (env.MOTION_PROVIDER || 'none') as MotionProviderName,
      /** 1 = hook only (the scene that decides whether people keep watching). */
      motionClipsPerVideo: Number(env.MOTION_CLIPS_PER_VIDEO || 1),
      concurrency: Number(env.IMAGE_CONCURRENCY || 3),
    },
    comfyui: {
      url: env.COMFYUI_URL || 'http://127.0.0.1:8188',
      /** API-format workflow exports in assets/comfy/ (see README). */
      imageWorkflow: env.COMFYUI_IMAGE_WORKFLOW || 'image_t2i.json',
      /** Optional reference-image edit workflow used for scenes with recurring characters. */
      imageEditWorkflow: env.COMFYUI_IMAGE_EDIT_WORKFLOW || 'image_edit.json',
      videoWorkflow: env.COMFYUI_VIDEO_WORKFLOW || 'video_i2v.json',
      imageWidth: Number(env.COMFYUI_IMAGE_WIDTH || 896),
      imageHeight: Number(env.COMFYUI_IMAGE_HEIGHT || 1600),
      videoWidth: Number(env.COMFYUI_VIDEO_WIDTH || 480),
      videoHeight: Number(env.COMFYUI_VIDEO_HEIGHT || 832),
      videoFps: Number(env.COMFYUI_VIDEO_FPS || 16),
      timeoutMs: Number(env.COMFYUI_TIMEOUT_MS || 20 * 60 * 1000),
    },
    fal: {
      apiKey: env.FAL_KEY || '',
      imageModel: env.FAL_IMAGE_MODEL || 'fal-ai/bytedance/seedream/v5/lite/text-to-image',
      /** Reference-image edit endpoint for scenes with recurring characters. */
      imageEditModel: env.FAL_IMAGE_EDIT_MODEL || 'fal-ai/bytedance/seedream/v5/lite/edit',
      imageCostUsd: Number(env.FAL_IMAGE_COST_USD || 0.035),
      videoModel: env.FAL_VIDEO_MODEL || 'fal-ai/kling-video/v2.5-turbo/standard/image-to-video',
      videoCostPerSecondUsd: Number(env.FAL_VIDEO_COST_PER_SECOND_USD || 0.042),
    },
    reddit: {
      access: (env.REDDIT_ACCESS || 'inbox') as RedditAccessMode,
      clientId: env.REDDIT_CLIENT_ID || '',
      clientSecret: env.REDDIT_CLIENT_SECRET || '',
      userAgent: env.REDDIT_USER_AGENT || 'node:faceless-video-pipeline:v2.0.0',
    },
    audio: {
      musicDir: env.MUSIC_DIR || path.join(root, 'assets', 'music'),
      /** Music bed level relative to the voice, before ducking. */
      musicVolume: Number(env.MUSIC_VOLUME || 0.18),
    },
    pixabay: {
      apiKey: env.PIXABAY_API_KEY || '',
    },
    pexels: {
      apiKey: env.PEXELS_API_KEY || '',
    },
    youtube: {
      clientId: env.YOUTUBE_CLIENT_ID || '',
      clientSecret: env.YOUTUBE_CLIENT_SECRET || '',
      refreshToken: env.YOUTUBE_REFRESH_TOKEN || '',
      privacy: env.YOUTUBE_PRIVACY || 'public',
    },
    meta: {
      accessToken: env.META_ACCESS_TOKEN || '',
      igBusinessId: env.INSTAGRAM_BUSINESS_ACCOUNT_ID || '',
      fbPageId: env.FACEBOOK_PAGE_ID || '',
      /** Meta Graph API version for Instagram and Facebook calls (v21.0 expires Jan 2027). */
      graphVersion: env.META_GRAPH_VERSION || 'v26.0',
    },
    schedule: {
      /** One video a day by default. */
      generate: env.CRON_GENERATE_SCHEDULE || '0 18 * * *',
      metrics: env.CRON_METRICS_SCHEDULE || '0 2 * * *',
      evolve: env.CRON_EVOLVE_SCHEDULE || '0 4 * * 0',
      enableAutoUpload: env.ENABLE_AUTO_UPLOAD === 'true',
    },
    dashboard: {
      /** The dashboard listens on 127.0.0.1 only; reach it from other devices through Tailscale. */
      port: Number(env.DASHBOARD_PORT || 4747),
      /** Host names the dashboard answers to; anything else is refused (blocks DNS rebinding). */
      allowedHosts: (env.DASHBOARD_ALLOWED_HOSTS || 'localhost,127.0.0.1')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    },
  };
}
