export type NicheCategory =
  | 'tech_ai_postmortems'
  | 'workplace_legal_drama'
  | 'finance_money_psychology'
  | 'cybersecurity_scam_breakdowns'
  | 'weird_history_mysteries';

export type HookArchetype =
  | 'shocking_mistake'
  | 'hidden_rule_exploit'
  | 'instant_karma_twist'
  | 'counterintuitive_fact';

export interface StrategyRules {
  version: number;
  updatedAt: string;
  explorationRate: number;
  targetDurationSeconds: { min: number; max: number };
  nicheWeights: Record<NicheCategory, number>;
  hookArchetypeWeights: Record<HookArchetype, number>;
  voicePool: string[];
  voiceSpeedRate: string;
  doRules: string[];
  dontRules: string[];
}

export interface RawTrendCandidate {
  externalId: string;
  niche: NicheCategory;
  sourcePlatform: 'reddit' | 'hackernews' | 'rss';
  title: string;
  bodyText: string;
  topComments: string[];
  sourceUrl: string;
  upvotes: number;
  commentCount: number;
  ageHours: number;
  velocityScore: number;
}

export interface ScriptSegment {
  segmentIndex: number;
  spokenText: string;
  onScreenHeadline: string;
  pexelsSearchQuery: string;
  sfxCue: 'whoosh' | 'pop' | 'riser' | 'none';
}

export interface GeneratedVideoScript {
  niche: NicheCategory;
  hookArchetype: HookArchetype;
  titleCardBadge: string;
  titleCardHeadline: string;
  hookText: string;
  segments: ScriptSegment[];
  loopBridgeText: string;
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

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

export interface PlatformUploadResult {
  youtubeVideoId?: string;
  instagramMediaId?: string;
  facebookVideoId?: string;
  errors: string[];
}
