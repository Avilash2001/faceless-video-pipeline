import type { StoryBrief, Storyboard } from '../../src/types.js';

/** A Story the fake Pipeline "finds": the same small heist every time. */
export const fakeStory: StoryBrief = {
  candidate: {
    externalId: 'wiki_1151369',
    niche: 'true_heists_cons',
    source: 'wikipedia',
    title: 'The Antwerp diamond heist',
    bodyText: 'Thieves emptied 123 vault boxes over a weekend.',
    topComments: [],
    sourceUrl: 'https://en.wikipedia.org/wiki/Antwerp_diamond_heist',
    sourceLabel: 'Wikipedia',
    popularity: 1,
    ageHours: 0,
  },
  premise: 'A crew beats the most secure vault in the world.',
  beats: ['The vault', 'The weekend', 'The sandwich'],
  twist: 'A half-eaten sandwich gives them away.',
  ending: 'Most of the diamonds are never found.',
  narratorPov: 'third_person',
  narratorGender: 'male',
  tone: 'wry',
  musicMood: 'tense',
};

export const fakeStoryboard: Storyboard = {
  niche: 'true_heists_cons',
  hookArchetype: 'cold_open_climax',
  isFiction: false,
  sourceUrls: ['https://en.wikipedia.org/wiki/Antwerp_diamond_heist'],
  creditLine: 'Based on a story from Wikipedia.',
  hookOverlayText: 'They beat the vault',
  visualStyle: { name: 'noir', prompt: 'moody noir illustration' },
  characters: [],
  scenes: [
    {
      index: 0,
      narration: 'They beat the most secure vault in the world.',
      visualPrompt: 'A vault door in the dark',
      stockQuery: 'vault door',
      characterIds: [],
      sameShotAsPrevious: false,
      camera: 'push_in',
      sfx: 'none',
      motionCandidate: true,
      motionPrompt: '',
    },
  ],
  musicMood: 'tense',
  narratorGender: 'male',
  fullNarrationText: 'They beat the most secure vault in the world.',
  youtubeMetadata: { title: 'They beat the vault', description: 'A heist.', tags: ['heist'] },
  instagramMetadata: { caption: 'They beat the vault', firstCommentPrompt: '' },
  facebookMetadata: { title: 'They beat the vault', description: 'A heist.' },
};
