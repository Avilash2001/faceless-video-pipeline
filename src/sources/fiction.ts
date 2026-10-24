import { getRecentStoryTitles } from '../db/index.js';
import { GENRES } from '../genres.js';
import { NicheCategory, StoryCandidate } from '../types.js';

/**
 * Original fiction has nothing to fetch: the story editor invents the story. This returns a
 * single seed candidate carrying the genre brief and recent titles so stories don't repeat.
 */
export function buildFictionSeed(niche: NicheCategory): StoryCandidate[] {
  const recent = getRecentStoryTitles(25);
  return [
    {
      externalId: `fiction_${Date.now()}`,
      niche,
      source: 'fiction',
      title: 'Original story (to be invented)',
      bodyText: [
        `Invent a brand-new story: ${GENRES[niche].label}.`,
        recent.length > 0
          ? `Do not reuse the premise, setting or twist of these recent videos:\n- ${recent.join('\n- ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      topComments: [],
      sourceUrl: null,
      sourceLabel: 'an original story',
      popularity: 1,
      ageHours: 0,
    },
  ];
}
