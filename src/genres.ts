import { NicheCategory, SourceKind } from './types.js';

/**
 * One consistent art direction is chosen per video and injected into every scene prompt.
 * Stylized looks are preferred over photorealism: they read well at phone size and avoid
 * passing off invented scenes of real events as footage.
 */
export const VISUAL_STYLES: Record<string, string> = {
  graphic_novel:
    'bold graphic-novel illustration, confident inked outlines, flat cel shading, dramatic rim lighting, limited teal-and-amber palette',
  cinematic_painterly:
    'cinematic digital painting, soft volumetric light, visible painterly brushwork, film-still composition, rich contrast',
  noir_comic:
    'high-contrast noir comic art, heavy black shadows, halftone texture, desaturated palette with a single red accent',
  stylized_3d:
    'stylized 3D animated feature-film look, expressive characters, soft global illumination, vibrant saturated colors',
  vintage_editorial:
    'vintage editorial illustration, aged paper texture, muted sepia and ink palette, fine engraved linework',
  anime_drama:
    'anime drama key visual, clean line art, cinematic lighting, detailed painted backgrounds',
};

export interface GenreSpec {
  source: SourceKind;
  /** Plain-language description used in LLM prompts. */
  label: string;
  subreddits?: string[];
  wikipediaCategories?: string[];
  /** Keys into VISUAL_STYLES; one is picked per video. */
  styles: string[];
}

export const GENRES: Record<NicheCategory, GenreSpec> = {
  reddit_revenge: {
    source: 'reddit',
    label: 'petty and pro revenge stories where someone gets exactly what they deserve',
    subreddits: ['pettyrevenge', 'ProRevenge', 'MaliciousCompliance'],
    styles: ['stylized_3d', 'graphic_novel'],
  },
  reddit_aita: {
    source: 'reddit',
    label: 'moral dilemma stories where the narrator asks if they were in the wrong',
    subreddits: ['AmItheAsshole', 'AITAH'],
    styles: ['stylized_3d', 'anime_drama'],
  },
  reddit_entitled: {
    source: 'reddit',
    label: 'encounters with outrageously entitled people and how they backfired',
    subreddits: ['entitledparents', 'EntitledPeople'],
    styles: ['stylized_3d', 'graphic_novel'],
  },
  reddit_workplace: {
    source: 'reddit',
    label: 'workplace and customer-service stories with absurd bosses or customers',
    subreddits: ['talesfromtechsupport', 'IDontWorkHereLady', 'talesfromretail'],
    styles: ['graphic_novel', 'stylized_3d'],
  },
  reddit_updates: {
    source: 'reddit',
    label: 'dramatic personal sagas with shocking updates and resolutions',
    subreddits: ['BestofRedditorUpdates'],
    styles: ['anime_drama', 'cinematic_painterly'],
  },
  true_heists_cons: {
    source: 'wikipedia',
    label: 'real heists, cons, impostors and fraud schemes',
    wikipediaCategories: [
      'Impostors',
      'Confidence tricksters',
      'Pyramid and Ponzi schemes',
      'Stolen works of art',
      'Bank robberies',
    ],
    styles: ['noir_comic', 'graphic_novel'],
  },
  true_vanished_unsolved: {
    source: 'wikipedia',
    label: 'real disappearances and unexplained vanishings',
    wikipediaCategories: [
      'Formerly missing people',
      'Unexplained disappearances',
      'People declared dead in absentia',
      'Lost explorers',
    ],
    styles: ['cinematic_painterly', 'vintage_editorial'],
  },
  true_survival: {
    source: 'wikipedia',
    label: 'real survival-against-the-odds stories',
    wikipediaCategories: [
      'Survivors of aviation accidents or incidents',
      'Shipwreck survivors',
      'Castaways',
      'Mountain rescue',
    ],
    styles: ['cinematic_painterly', 'graphic_novel'],
  },
  true_business_blunders: {
    source: 'wikipedia',
    label: 'real corporate scandals and business decisions that went spectacularly wrong',
    wikipediaCategories: ['Corporate scandals', 'Accounting scandals', 'Product recalls'],
    styles: ['graphic_novel', 'vintage_editorial'],
  },
  fiction_drama: {
    source: 'fiction',
    label: 'original short dramas with a twist ending (clearly fiction)',
    styles: ['anime_drama', 'cinematic_painterly', 'stylized_3d'],
  },
  fiction_confessions: {
    source: 'fiction',
    label:
      'original first-person confession, revenge and entitled-people stories in the style of viral Reddit posts (invented, never claimed to be from Reddit)',
    styles: ['stylized_3d', 'graphic_novel', 'anime_drama'],
  },
};
