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
7. **Publish (`publisher.ts`)** — YouTube (with the synthetic-content disclosure flag and configurable privacy), Instagram Reels, Facebook Reels; descriptions carry the credit line and sources.
8. **Learning loop (`analyticsLoop.ts`)** — pulls retention/shares/views and lets Gemini re-weight genres, hook types and rules weekly.

## Visual providers

| `IMAGE_PROVIDER` | What | Cost per video (~11 images) | Needs |
|---|---|---|---|
| `gemini` | Nano Banana 2.1, 2K 9:16, character references | ~$0.55 | Billing enabled on the Gemini API key (free tier allows 0 images) |
| `comfyui` | Local ComfyUI, e.g. FLUX.2 klein 4B | $0 | A running ComfyUI server + exported workflows |
| `fal` | fal.ai Seedream 5 Lite (+ edit endpoint for references) | ~$0.40 | `FAL_KEY` |
| `stock` | Pixabay/Pexels clips | $0 | Optional `PIXABAY_API_KEY`; generic footage |

| `MOTION_PROVIDER` | What | Cost (2 clips, hook + climax) | Needs |
|---|---|---|---|
| `none` | Pan/zoom only | $0 | — |
| `gemini` | Gemini Omni Flash image-to-video | ~$1.00 | Gemini billing |
| `fal` | Kling 2.5 Turbo image-to-video | ~$0.42 | `FAL_KEY` |
| `comfyui` | Wan 2.2 I2V (+ 4-step LoRA) | $0 (minutes per clip on a 3060) | ComfyUI video workflow |

`IMAGE_FALLBACK` (default `stock`) is used per scene when the primary provider fails twice.

## Quick start

```bash
# 1. Install dependencies. ffmpeg must include libass (subtitle burn-in):
#    macOS: brew install ffmpeg-full   (keg-only; keep FFMPEG_PATH pointing at it)
#    Windows: a "full" build from gyan.dev, then FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
npm install

# 2. Configure
cp .env.example .env

# 3. Preview a story without spending anything on images or rendering
npm run generate -- --genre true_heists_cons --storyboard-only

# 4. Make a video (saved under output/<run>/, not uploaded)
npm run generate -- --genre fiction_confessions --images gemini --no-upload

# 5. Analytics + weekly strategy evolution, or run everything on a schedule
npm run sync-metrics
npm run evolve
npm run daemon
```

Per-run flags: `--genre <id>`, `--images <gemini|comfyui|fal|stock>`, `--motion <none|gemini|fal|comfyui>`, `--storyboard-only`, `--no-upload`. Each run writes `storyboard.json`, `timing.json`, the scene images, voice, captions and `<run>_final.mp4` to `output/<run>/`.

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

- Music: put royalty-free tracks in `assets/music/<mood>/` (`tense`, `mysterious`, `upbeat`, `emotional`, `dark`, `playful`) or straight into `assets/music/`; they're ducked under the voice.
- SFX: `assets/sfx/whoosh.*`, `impact.*`, `riser.*` play on the storyboard's cues. Missing files are skipped.

## Compliance defaults

- YouTube uploads set `containsSyntheticMedia: true`; turn on Meta's "AI info" label for Reels.
- True stories never invent facts; fiction is labelled; Reddit stories are retold, not read.
- Keep `ENABLE_AUTO_UPLOAD=false` while testing.

See `BLUEPRINT.md` for YouTube/Meta API setup.
