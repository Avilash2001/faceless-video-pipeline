# Autonomous Story-Driven Faceless Video Pipeline (TypeScript)

A closed-loop content factory for **YouTube Shorts**, **Instagram Reels**, and **Facebook Reels** that tells *stories*, not commentary: every scene gets its own visual that shows what's being narrated, in one consistent art style with recurring characters.

## How a video is made

```
genre (bandit) → story source → story editor → storyboard → voice + word timings
  → character sheets → scene images → optional AI motion clips → render → publish
```

1. **Genres & sources (`src/genres.ts`, `src/sources/`)** — 11 genres across three sources, weighted by `data/strategy_rules.json`:
   - **Reddit-style** (`reddit_revenge`, `reddit_aita`, `reddit_entitled`, `reddit_workplace`, `reddit_updates`) — see [Reddit access](#reddit-access).
   - **True documented stories** (`true_heists_cons`, `true_vanished_unsolved`, `true_survival`, `true_business_blunders`) — Wikipedia categories ranked by the last 30 days of pageviews. Facts only; text is never copied; the source is credited.
   - **Original fiction** (`fiction_drama`, `fiction_confessions`) — invented stories, labelled as fiction. `fiction_confessions` gives the Reddit confession/revenge feel with no source risk.
2. **Story editor (`src/services/storyEditor.ts`)** — Gemini scores candidates on a rubric (stakes, reversal, one-line payoff, visual potential, ad safety, privacy) and writes a brief: beats, twist, ending, narrator POV/gender, tone, music mood.
3. **Storyboard (`src/services/llmEngine.ts`)** — 9-14 scenes, one short narration line each (a new visual every 2-4 s), a hook in ≤10 words, a mid-point reversal, a payoff that loops back to the hook, per-scene visual prompts, camera moves, SFX cues, a fixed cast and art style, and platform metadata.
4. **Voice & timing (`ttsEngine.ts`, `sceneTiming.ts`)** — Microsoft Edge neural TTS (free) with word timings; the voice matches the narrator's gender; every scene is aligned to the exact word where it starts.
5. **Visuals (`src/visuals/`)** — pluggable providers, see below. Character reference sheets are generated first and attached to every scene they appear in.
6. **Render (`videoComposer.ts`)** — per-scene pan/zoom on stills (or AI clips), hard cuts on the narration, karaoke captions with a rotating highlight colour, a hook overlay on the first frame, voice + ducked music + SFX.
7. **Publish (`publisher.ts`)** — one call per Platform, each returning its Post's ID and link or its error: YouTube (with the synthetic-content disclosure flag and configurable privacy), Instagram Reels, Facebook Reels; descriptions carry the credit line and sources.
8. **Learning loop (`analyticsLoop.ts`)** — pulls retention/shares/views and lets Gemini re-weight genres, hook types and rules weekly.

## Visual providers

| `IMAGE_PROVIDER` | What | Cost per video (~11 images) | Needs |
|---|---|---|---|
| `gemini` | Nano Banana 2.1, 1K 9:16, one shared cast sheet for references | ~$0.27-0.34 | Billing enabled on the Gemini API key (free tier allows 0 images) |
| `comfyui` | Local ComfyUI, e.g. FLUX.2 klein 4B | $0 | A running ComfyUI server + exported workflows |
| `fal` | fal.ai Seedream 5 Lite (+ edit endpoint for references) | ~$0.40 | `FAL_KEY` |
| `stock` | Pixabay/Pexels clips | $0 | Optional `PIXABAY_API_KEY`; generic footage |

| `MOTION_PROVIDER` | What | Cost (2 clips, hook + climax) | Needs |
|---|---|---|---|
| `none` | Pan/zoom only | $0 | — |
| `gemini` | Gemini Omni Flash image-to-video | ~$0.40 per clip | Gemini billing |
| `fal` | Kling 2.5 Turbo image-to-video | ~$0.42 | `FAL_KEY` |
| `comfyui` | Wan 2.2 I2V (+ 4-step LoRA) | $0 (minutes per clip on a 3060) | ComfyUI video workflow |

When a scene fails twice, `IMAGE_FALLBACK` decides what happens: `none` (default) reuses a neighbouring scene's image with a different camera move so the art style stays consistent; `comfyui`, `fal` or `stock` generate it elsewhere.

## Costs

A Gemini video costs about **$0.30 (≈ ₹30 with GST)**: ~$0.27-0.34 for images plus ~$0.01 of text. How it's kept low:
- **1K images** ($0.034 each); the composer upscales them for pan/zoom. Set `GEMINI_IMAGE_SIZE=2K` for sharper frames at $0.050.
- **One cast sheet** per video instead of one per character, attached as the reference for every scene with people.
- **Shot reuse:** the storyboard marks lines that continue the same moment (`sameShotAsPrevious`); they reuse the previous image with a different camera move, so ~11 scenes need ~7-9 images.
- **Cheap text:** the story editor runs on `GEMINI_EDITOR_MODEL` (flash-lite) and thinking is kept `low` (thinking tokens bill as output).
- **No motion clips by default** (`MOTION_PROVIDER=none`); `MOTION_CLIPS_PER_VIDEO=1` animates only the hook.
- **Daily budget:** every paid call is logged to the `spend_log` table, against the run it was made in, and checked against `DAILY_BUDGET_USD` (default $0.50). When paid images would exceed it, the run switches to ComfyUI if `IMAGE_FALLBACK=comfyui`, otherwise it skips the video rather than publishing a stock-footage one. Each run ends with `API spend for this video: $… (≈ ₹… incl. tax)`.
- **Free iteration:** `--storyboard <run>/storyboard.json --reuse-visuals <run>` re-renders a video (new voice, captions, audio) without paying for images again.
- **$0 visuals:** run ComfyUI on a GPU PC (`IMAGE_PROVIDER=comfyui`) and keep Gemini as the fallback.

Google also enforces a monthly spending cap on the AI Studio project; if it's reached, every Gemini call (text included) fails until you raise it.

## Quick start

```bash
# 1. Install dependencies. ffmpeg must include libass (subtitle burn-in):
#    macOS: brew install ffmpeg-full   (keg-only; keep FFMPEG_PATH pointing at it)
#    Windows: a "full" build from gyan.dev, then FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
npm install

# 2. Configure
cp .env.example .env

# 3. One-time audio setup: synthesized SFX (free, already in the repo) and a Lyria music
#    library (~$0.48 once for six moods; copy assets/music/ to other machines)
npm run make-sfx
npm run make-music

# 4. Preview a story without spending anything on images or rendering
npm run generate -- --genre true_heists_cons --storyboard-only

# 5. Make a video (saved under output/<run>/, not uploaded)
npm run generate -- --genre fiction_confessions --images gemini --no-upload

# 6. Analytics + weekly strategy evolution, or run everything on a schedule
npm run sync-metrics
npm run evolve
npm run daemon
```

Per-run flags: `--genre <id>`, `--images <gemini|comfyui|fal|stock>`, `--motion <none|gemini|fal|comfyui>`, `--storyboard-only`, `--storyboard <path>` (re-render a saved storyboard), `--reuse-visuals <run folder>` (reuse its images), `--no-upload`.

Each run writes `storyboard.json`, `timing.json`, the scene images, voice, captions, `<run>_final.mp4` and `run.log` (everything the run printed) to `output/<run>/`. The flags apply to that run only.

`npm run daemon` runs the generate, metrics and evolve schedules and serves the dashboard at http://localhost:4747 (`DASHBOARD_PORT`). It listens on this machine only and has no login; to open it from another device, reach it over Tailscale and add that host name to `DASHBOARD_ALLOWED_HOSTS`.

To run it all day, start it with pm2 instead: `pm2 start ecosystem.config.cjs`. pm2 starts it again after a crash, and the dashboard's **Restart** button works only under pm2. **[docs/DAEMON_SETUP.md](docs/DAEMON_SETUP.md)** covers pm2 on macOS and Windows, starting it when you log in, keeping the PC awake, Tailscale, ntfy and healthchecks.io.

Problems become **Alerts**: they show at the top of the dashboard while active and are pushed to your phone through [ntfy](https://ntfy.sh) (`NTFY_TOPIC`) when they start and when they clear. Pushes are held during Quiet hours (`QUIET_HOURS`, default 23:00-08:00) and sent as one push when they end. Set `HEALTHCHECK_URL` to a [healthchecks.io](https://healthchecks.io) check and the daemon pings it every 5 minutes; point that check at the same ntfy topic to hear when the PC or the daemon stops. An Alert also lists keys `.env.example` has that your `.env` lacks, or leaves empty where `.env.example` fills them in.

While a Run is in progress, the dashboard and the Run's page show its step (N of 7) and its log as they happen. **Run now** on the dashboard starts a Run straight away, with the command line's options under **Options**: Genre, image Provider, motion Provider, storyboard only and no upload. They apply to that Run only. Run now is off while a Run is in progress. When what is left of today's `DAILY_BUDGET_USD` is less than a Video is estimated to cost (the image Provider's price for 12 images, plus about $0.01 of text), Run now warns first; **Run anyway** still starts it. A Run started from the command line while the daemon is running shows there too, caught up every 2 seconds while a page is open.

The dashboard's **Strategy** page shows the current `data/strategy_rules.json` (Genre and hook weights, rules, voices) and every evolve, newest first, with the critic's summary and how each weight changed from the version before. A Genre that still has a weight but is no longer in `src/genres.ts` is labelled retired.

`npm test` runs the tests (Vitest); `npm run typecheck` checks types.

To create the YouTube, Instagram and Facebook accounts and fill in the publishing keys, follow **[docs/CHANNEL_SETUP.md](docs/CHANNEL_SETUP.md)**.

## Reddit access

Reddit closed self-service API access in November 2025, and its User Agreement and Data API Terms prohibit commercial use and derivative works of user content without an agreement. Pick a mode with `REDDIT_ACCESS`:

- **`inbox` (default)** — drop stories you have permission to adapt into `data/story_inbox/`: `.txt`/`.md` (first line = title, rest = body) or `.json` (`{ "title", "body", "sourceUrl"?, "credit"?, "niche"? }`). Each file is used once.
- **`api`** — request access at Reddit's developer support form; once approved, set `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` and a `REDDIT_USER_AGENT` like `node:yourapp:v1.0 (by /u/you)`. Monetized use still needs a commercial agreement.
- **`rss`** — public top-of-week feeds (full text, ~1 request per minute). Fragile and against Reddit's no-scraping terms; opt in at your own risk.

In every mode the storyboard retells the story in original words with names and details changed and credits the source; it never reads the post verbatim.

## Local generation on a Windows PC (RTX 3060 12 GB)

1. Install [ComfyUI](https://github.com/Comfy-Org/ComfyUI) (portable build on Windows) and start it; it listens on `http://127.0.0.1:8188`.
2. Images work out of the box: download the three FLUX.2 klein 4B files listed in `assets/comfy/README.md` (~16 GB, Apache 2.0) into ComfyUI's `models/` folders. `assets/comfy/image_t2i.json` and `image_edit.json` already point at them.
3. Video (optional): load the `video_wan2_2_14B_i2v` template from Comfy-Org/workflow_templates, add the lightx2v 4-step LoRA (fp8 ~38 GB; use the GGUF Q4_K_M models with 32 GB RAM), then **File → Export (API)** into `assets/comfy/video_i2v.json`.
4. Set `IMAGE_PROVIDER=comfyui` (and `MOTION_PROVIDER=comfyui`), and `COMFYUI_URL` if ComfyUI runs on another machine.

Measured on a base M4 Mac (16 GB): ~10-20 minutes per image because the 8 GB text encoder and 7.4 GB model don't fit together in memory. Fine for previews; use a GPU with 12 GB+ VRAM for production.

Prompt, seed, size, frame count and reference images are filled in automatically (see `assets/comfy/README.md`).

## Audio

- **Music:** `npm run make-music` generates one ~2-minute instrumental per mood (`tense`, `mysterious`, `upbeat`, `emotional`, `dark`, `playful`) into `assets/music/<mood>/` with Lyria ($0.08 each, once). Each video starts its mood's track at a random point, fades it in and out, and ducks it under the voice. You can also drop your own royalty-free tracks there.
- **SFX:** `npm run make-sfx` synthesizes `assets/sfx/whoosh.wav`, `impact.wav` and `riser.wav` (no licences involved); they play on the storyboard's cues.
- **Loudness:** every mix is normalized to -14 LUFS / -1.5 dBTP, the level YouTube and Instagram play at.
- **Endings:** the final line is checked; an abrupt ending ("…proving that…") is rewritten by a cheap model call, or trimmed to its last complete clause.

## Compliance defaults

- True stories never invent facts; fiction is labelled; Reddit stories are retold, not read.
- YouTube uploads set `containsSyntheticMedia: true`; Instagram and Facebook Reels send `is_ai_generated: true` (Meta's "AI info" label).
- Keep `ENABLE_AUTO_UPLOAD=false` while testing.

See `BLUEPRINT.md` for YouTube/Meta API setup.
