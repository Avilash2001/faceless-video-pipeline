import { CONFIG } from '../config.js';
import { GENRES } from '../genres.js';
import { NicheCategory, StoryCandidate, StrategyRules } from '../types.js';
import { buildFictionSeed } from './fiction.js';
import { fetchRedditCandidates } from './reddit.js';
import { pickWeightedKey } from './util.js';
import { fetchWikipediaCandidates } from './wikipedia.js';

async function fetchCandidatesForNiche(niche: NicheCategory): Promise<StoryCandidate[]> {
  switch (GENRES[niche].source) {
    case 'reddit':
      return fetchRedditCandidates(niche);
    case 'wikipedia':
      return fetchWikipediaCandidates(niche);
    case 'fiction':
      return buildFictionSeed(niche);
  }
}

/**
 * Picks a genre with the epsilon-greedy bandit (or the forced one), then falls through
 * the remaining genres by weight until a source returns fresh candidates.
 */
export async function findStoryCandidates(
  strategy: StrategyRules,
  forcedNiche?: NicheCategory
): Promise<{ niche: NicheCategory; candidates: StoryCandidate[] }> {
  const first = forcedNiche || pickWeightedKey(strategy.nicheWeights, strategy.explorationRate);
  const order: NicheCategory[] = forcedNiche
    ? [first]
    : [
        first,
        ...(Object.keys(strategy.nicheWeights) as NicheCategory[])
          .filter((n) => n !== first)
          .sort((a, b) => strategy.nicheWeights[b] - strategy.nicheWeights[a]),
      ];

  for (const niche of order) {
    try {
      const candidates = await fetchCandidatesForNiche(niche);
      if (candidates.length > 0) return { niche, candidates };
      console.log(`[Sources] No fresh candidates for ${niche}; trying the next genre.`);
    } catch (err) {
      console.warn(`[Sources] ${niche} failed:`, (err as Error).message);
    }
  }
  const hint =
    forcedNiche && GENRES[forcedNiche].source === 'reddit'
      ? ` Reddit access mode is "${CONFIG.reddit.access}": add stories to data/story_inbox/ (inbox), set REDDIT_CLIENT_ID/SECRET (api), or set REDDIT_ACCESS=rss.`
      : ' Check source config (REDDIT_ACCESS, network).';
  throw new Error(`No story candidates for ${forcedNiche ? `genre ${forcedNiche}` : 'any genre'}.${hint}`);
}
