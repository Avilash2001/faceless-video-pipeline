# Autonomous Multi-Platform Faceless Video Pipeline — Blueprint & API Setup

This blueprint covers the architectural decisions, multi-platform OAuth/API setup steps for **YouTube Shorts**, **Instagram Reels**, and **Facebook Reels**, and how the closed-loop telemetry engine works.

## 1. Recommended Architecture Decisions

| Component | Selected Stack | Monthly Cost | Architectural Rationale |
| :--- | :--- | :--- | :--- |
| **Content Niche Engine** | Multi-Niche Velocity Scorer (`Reddit JSON` + `HN Algolia`) | **$0** | Starts across 5 high-RPM niches (`tech_ai_postmortems`, `workplace_legal_drama`, `finance_money_psychology`, `cybersecurity_scam_breakdowns`, `weird_history_mysteries`) and uses an epsilon-greedy bandit (`explorationRate: 0.25`) to shift 75% of production into whichever niche earns the highest retention and share rate. |
| **Rendering Engine** | `fluent-ffmpeg` + `.ass` Karaoke Subtitles + `satori` (`@resvg/resvg-js`) | **$0** | Uses 10x less RAM/CPU than headless Chromium/Remotion, allowing you to render 60-second 1080x1920 30fps videos in ~12 seconds on your Mac or a $4/mo VPS. |
| **Visual Backdrop** | Hybrid **Pexels Video API** (Portrait HD) + Local B-Roll Fallback | **$0** | Gemini assigns a concrete 2–4 word `pexelsSearchQuery` to every 4-second script beat. The pipeline downloads and caches matching vertical stock footage automatically and falls back to `./assets/broll/*.mp4` if offline. |
| **Voice + Word Timings** | `msedge-tts` (`en-US-AndrewNeural` / `BrianNeural` / `ChristopherNeural`) | **$0** | Streams natural neural audio and emits exact `WordBoundary` millisecond offsets natively—eliminating both ElevenLabs fees ($22+/mo) and Whisper transcription costs. |
| **Brain & Critic Loop** | `@google/genai` (`gemini-2.5-flash` with `responseSchema`) | **~$0.20/mo** | Enforces strict JSON outputs for script segments, loop bridges, B-roll cues, platform captions, and weekly strategy rule mutations. |

## 2. Setting Up Multi-Platform Auto-Publishing

### A. YouTube Shorts (`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`)
1. Go to the **Google Cloud Console**, create a project, and enable **YouTube Data API v3** and **YouTube Analytics API**.
2. Create **OAuth 2.0 Client ID** credentials (Web application) and add `https://developers.google.com/oauthplayground` to Authorized redirect URIs.
3. Open **Google OAuth2 Playground**, click the gear icon (top right), check **Use your own OAuth credentials**, and enter your Client ID and Client Secret.
4. Select scopes:
   * `https://www.googleapis.com/auth/youtube.upload`
   * `https://www.googleapis.com/auth/yt-analytics.readonly`
5. Authorize your YouTube channel, click **Exchange authorization code for tokens**, and paste the `refresh_token` into `.env`.

### B. Instagram Reels & Facebook Reels (`META_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`, `FACEBOOK_PAGE_ID`)
1. Create a **Facebook Page** for your brand and switch your Instagram account to a **Professional (Creator or Business) Account**, then link them in Meta Business Suite.
2. Go to **developers.facebook.com**, create a **Business App**, and open **Graph API Explorer**.
3. Generate a token with these permissions:
   * `instagram_basic`
   * `instagram_content_publish`
   * `instagram_manage_insights`
   * `pages_show_list`
   * `pages_read_engagement`
   * `pages_manage_posts`
   * `read_insights`
4. Exchange the short-lived user token for a **Long-Lived Page Access Token** (or create a non-expiring **System User Token** in Meta Business Settings).
5. **Handling `PUBLIC_VIDEO_BASE_URL` for Instagram Reels:**
   * While **Facebook Reels** accepts direct binary buffer uploads (`rupload.facebook.com`), the **Instagram Graph API** requires a publicly reachable URL (`video_url`) to fetch the MP4 during container creation.
   * You can point `PUBLIC_VIDEO_BASE_URL` to a Cloudflare R2 public bucket (10 GB/month free tier) or a static Nginx directory on a VPS.
