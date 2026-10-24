# Faceless Video Pipeline

An autonomous pipeline that turns stories into short vertical videos and posts them to YouTube Shorts, Instagram Reels and Facebook Reels, learning from how they perform.

## Language

### Stories and runs

**Genre**:
A named kind of story (such as `true_heists_cons`), tied to one Source, that the strategy weights when choosing what to make next.
_Avoid_: Niche, category

**Retired genre**:
A Genre that appears on past Runs but is no longer offered.

**Source**:
Where story candidates come from: the Reddit inbox, Wikipedia, or original fiction.
_Avoid_: Feed, provider

**Inbox**:
The folder of stories you have permission to adapt, which the Reddit genres draw from when Reddit access is in inbox mode.
_Avoid_: Queue, drop folder

**Story**:
A story candidate the story editor picked, together with its brief. One Story can have many Runs.
_Avoid_: Video, script

**Storyboard**:
The scene-by-scene plan for a Story: narration lines, visual prompts, cast, art style and platform metadata.
_Avoid_: Script

**Run**:
One attempt of the pipeline for a Story, ending in exactly one outcome: storyboard only, failed, rendered, or posted. A Run counts as posted once any of its Posts succeeds.
_Avoid_: Cycle, job, render

**Slot**:
A time the generate schedule says a Run should start. A Slot is filled (a Run started), skipped (paused, a Run already in progress, or over the Daily budget) or missed (the daemon was down).
_Avoid_: Tick, trigger, scheduled run

**Re-render**:
A Run that reuses an earlier Run's Storyboard and scene images, so its visuals cost nothing.
_Avoid_: Retry (that is for Posts), regenerate

**Video**:
The final MP4 a Run renders. A Run has at most one Video.
_Avoid_: Short, reel, clip

**Post**:
One attempt to publish a Video on one Platform, which either succeeded (with a link) or failed (with an error). A retry is a new Post.
_Avoid_: Upload, publication

### Connections

**Connection**:
Any external Platform, Provider or Source the pipeline depends on.
_Avoid_: Integration

**Platform**:
A service Videos are posted to: YouTube, Instagram or Facebook.
_Avoid_: Channel, destination, provider

**Account**:
Your presence on a Platform: the YouTube channel, the Instagram business account or the Facebook Page.
_Avoid_: Channel, page, profile

**Provider**:
A service that makes text or media for a Run: Gemini, fal, ComfyUI, stock footage, Edge TTS.
_Avoid_: Platform, vendor, engine

### Operations

**Alert**:
A condition that needs your attention, such as a failed Run, an expiring token or low disk space. An Alert stays active until the condition clears.
_Avoid_: Red flag, warning, notification

**Quiet hours**:
The nightly window in which new Alerts are held, then sent together in the morning.

### Money

**Daily budget**:
The most the pipeline may spend on paid Providers in one UTC day; paid work past it is skipped.
_Avoid_: Spend limit, cap
