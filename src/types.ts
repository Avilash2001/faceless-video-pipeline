import type { ImageProviderName, MotionProviderName } from './loadConfig.js';

export type SourceKind = 'reddit' | 'wikipedia' | 'fiction';

export type NicheCategory =
  | 'reddit_revenge'
  | 'reddit_aita'
  | 'reddit_entitled'
  | 'reddit_workplace'
  | 'reddit_updates'
  | 'true_heists_cons'
  | 'true_vanished_unsolved'
  | 'true_survival'
  | 'true_business_blunders'
  | 'fiction_drama'
  | 'fiction_confessions';

export type HookArchetype =
  | 'cold_open_climax'
  | 'shocking_confession'
  | 'impossible_question'
  | 'stakes_reveal'
  | 'twist_tease';

export type NarratorGender = 'male' | 'female';

export type MusicMood = 'tense' | 'mysterious' | 'upbeat' | 'emotional' | 'dark' | 'playful';

export type CameraMove = 'push_in' | 'pull_out' | 'pan_left' | 'pan_right' | 'pan_up' | 'pan_down';

export type SfxCue = 'whoosh' | 'impact' | 'riser' | 'none';

export interface StrategyRules {
  version: number;
  updatedAt: string;
  explorationRate: number;
  targetDurationSeconds: { min: number; max: number };
  nicheWeights: Record<NicheCategory, number>;
  hookArchetypeWeights: Record<HookArchetype, number>;
  voicePool: Record<NarratorGender, string[]>;
  voiceSpeedRate: string;
  doRules: string[];
  dontRules: string[];
}

/** A raw story lead from a source adapter, before the story editor picks one. */
export interface StoryCandidate {
  externalId: string;
  niche: NicheCategory;
  source: SourceKind;
  title: string;
  bodyText: string;
  topComments: string[];
  /** Null for invented fiction. */
  sourceUrl: string | null;
  /** Credit line for descriptions, e.g. "a story shared on r/pettyrevenge". */
  sourceLabel: string;
  popularity: number;
  ageHours: number;
}

/** The story editor's distilled version of the chosen candidate. */
export interface StoryBrief {
  candidate: StoryCandidate;
  premise: string;
  beats: string[];
  twist: string;
  ending: string;
  narratorPov: 'first_person' | 'third_person';
  narratorGender: NarratorGender;
  tone: string;
  musicMood: MusicMood;
}

export interface CharacterSpec {
  id: string;
  name: string;
  /** Generic, name-free label for image prompts ("the young footballer"); image models refuse real names. */
  role: string;
  /** Fixed visual description reused in every image prompt for consistency. */
  appearance: string;
}

export interface StoryScene {
  index: number;
  narration: string;
  visualPrompt: string;
  /** 2-4 word stock-footage query, used only when generation falls back to stock. */
  stockQuery: string;
  characterIds: string[];
  /** Reuse the previous scene's image (same moment/place) with a different camera move. */
  sameShotAsPrevious: boolean;
  camera: CameraMove;
  sfx: SfxCue;
  /** True for the 1-2 scenes worth animating with an AI video clip (hook, climax). */
  motionCandidate: boolean;
  motionPrompt: string;
}

export interface Storyboard {
  niche: NicheCategory;
  hookArchetype: HookArchetype;
  isFiction: boolean;
  sourceUrls: string[];
  creditLine: string;
  hookOverlayText: string;
  visualStyle: { name: string; prompt: string };
  characters: CharacterSpec[];
  scenes: StoryScene[];
  musicMood: MusicMood;
  narratorGender: NarratorGender;
  fullNarrationText: string;
  youtubeMetadata: {
    title: string;
    description: string;
    tags: string[];
  };
  instagramMetadata: {
    caption: string;
    firstCommentPrompt: string;
  };
  facebookMetadata: {
    title: string;
    description: string;
  };
}

export interface TimedScene extends StoryScene {
  startMs: number;
  endMs: number;
}

export interface SceneMedia {
  sceneIndex: number;
  kind: 'image' | 'video';
  path: string;
  provider: string;
}

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

/** What one Run is asked to do. Each Run gets its own, so nothing carries over to the next. */
export interface RunOptions {
  /** Force a Genre instead of letting the strategy pick. */
  genre?: NicheCategory;
  /** The image Provider for this Run; IMAGE_PROVIDER when unset. */
  imageProvider?: ImageProviderName;
  /** The motion Provider for this Run; MOTION_PROVIDER when unset. */
  motionProvider?: MotionProviderName;
  /** Stop after writing the Storyboard (no voice, visuals or render). */
  storyboardOnly?: boolean;
  /** Set false to skip publishing even when ENABLE_AUTO_UPLOAD=true. */
  upload?: boolean;
  /** Re-render: reuse an earlier Run's storyboard.json instead of finding a new Story. */
  storyboardPath?: string;
  /** Re-render: reuse the scene visuals in an earlier Run's folder instead of paying for them again. */
  reuseVisualsDir?: string;
}

/** How the Pipeline tells its caller where a Run has got to. */
export interface RunProgress {
  /** Step `step` of 7 has started. */
  step(step: number, message: string): void;
  /** The Run's output folder now exists. */
  folder(dir: string): void;
}

/** What the Pipeline made of a Run: a Storyboard and, unless the Run was storyboard only, a Video. */
export interface PipelineResult {
  story: StoryBrief;
  storyboard: Storyboard;
  /** The strategy version the Run was made under. */
  strategyVersion: number;
  video?: RenderedVideo;
}

/** The final MP4 a Run rendered, with the voice it was read in. */
export interface RenderedVideo {
  path: string;
  durationSec: number;
  voiceName: string;
}

/** One push to the operator's phone. */
export interface Push {
  title: string;
  message: string;
}
