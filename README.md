# Autonomous Self-Optimizing Faceless Video Pipeline (TypeScript)

A zero-bloat, closed-loop content factory built for **YouTube Shorts**, **Instagram Reels**, and **Facebook Reels**.

## Architecture Highlights

1. **Multi-Niche Trend Velocity Engine (`src/services/trendFinder.ts`)**
   - Polls Reddit JSON endpoints and Hacker News Algolia across 5 high-RPM niches (`tech_ai_postmortems`, `workplace_legal_drama`, `finance_money_psychology`, `cybersecurity_scam_breakdowns`, `weird_history_mysteries`).
   - Scores candidates by upvote velocity and comment-to-upvote controversy ratio, weighted by your live `data/strategy_rules.json`.
2. **Transformative Script & Visual Director (`src/services/llmEngine.ts`)**
   - Uses `@google/genai` (`gemini-2.5-flash`) with strict JSON `responseSchema`.
   - Synthesizes the core incident with top community commentary so every video is transformative and monetization-safe.
   - Injects seamless loop bridges (`loopBridgeText`) and per-segment Pexels vertical B-roll search queries.
3. **Zero-Cost Neural TTS + Karaoke `.ass` Captions (`src/services/ttsEngine.ts`, `src/services/subtitleBuilder.ts`)**
   - Uses `msedge-tts` (`en-US-AndrewNeural`, `en-US-BrianNeural`, `en-US-ChristopherNeural`) with native `WordBoundary` events.
   - Generates pop-in 3-word karaoke captions with active-word gold highlighting positioned in the vertical safe zone (`MarginV=460`) above YT/IG/FB UI buttons.
4. **Hybrid Visual Engine + Satori Card + FFmpeg (`src/services/visualEngine.ts`, `src/services/videoComposer.ts`)**
   - Fetches and caches vertical HD clips from the free **Pexels Video API** per script segment, falling back to `./assets/broll/*.mp4`.
   - Renders a custom opening title card PNG via `satori` + `@resvg/resvg-js` (optional: drop `Inter-Bold.ttf` into `./assets/fonts/`).
5. **Concurrent Multi-Platform Publisher (`src/services/publisher.ts`)**
   - **YouTube Shorts**: Official `googleapis` `youtube.videos.insert`.
   - **Instagram Reels**: Official Graph API v21.0 `/media` + `/media_publish` + automated pinned first-comment question.
   - **Facebook Reels**: Official Graph API v21.0 `/video_reels` 3-phase binary upload.
6. **Self-Optimizing Telemetry Critic (`src/services/analyticsLoop.ts`)**
   - Pulls 48h/7d retention %, shares, saves, and views across YT, IG, and FB.
   - Computes a normalized `composite_reward_score` in SQLite (`data/pipeline.sqlite`).
   - Runs a weekly Gemini critic job that compares your top 4 and bottom 4 videos and rewrites `data/strategy_rules.json` (shifting niche weights, hook archetype weights, target duration, and `doRules`/`dontRules`).

## Quick Start

```bash
# 1. Install dependencies (ensure ffmpeg is installed on your Mac: brew install ffmpeg)
npm install

# 2. Copy and configure environment variables
cp .env.example .env

# 3. Optional: Drop 1-2 fallback vertical .mp4 clips into ./assets/broll/
#    and Inter-Bold.ttf into ./assets/fonts/

# 4. Run a single end-to-end generation cycle
npm run generate

# 5. Sync cross-platform analytics from YT, IG, and FB
npm run sync-metrics

# 6. Trigger the weekly Gemini strategy mutation loop
npm run evolve

# 7. Run 24/7 autonomous cron daemon (or manage via PM2: pm2 start "npm run daemon" --name video-bot)
npm run daemon
```
