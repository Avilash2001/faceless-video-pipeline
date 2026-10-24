import { Type } from '@google/genai';
import { CONFIG } from '../config.js';
import { GENRES } from '../genres.js';
import { NicheCategory, StoryBrief, StoryCandidate } from '../types.js';
import { generateContentWithFallback } from './gemini.js';

const MUSIC_MOODS = ['tense', 'mysterious', 'upbeat', 'emotional', 'dark', 'playful'];

/**
 * Picks the most story-worthy candidate with an explicit rubric and distills it into a brief
 * (beats, twist, ending, narrator). For fiction it invents the story from the genre seed.
 */
export async function selectAndBriefStory(
  niche: NicheCategory,
  candidates: StoryCandidate[]
): Promise<StoryBrief> {
  const genre = GENRES[niche];
  const isFiction = genre.source === 'fiction';

  const systemInstruction = `You are the story editor for a short-form narrated story channel (YouTube Shorts, Instagram Reels, Facebook Reels).
Genre: ${genre.label}.

${
  isFiction
    ? `Invent ONE original story. It must be clearly fictional, never presented as a real event or as a Reddit post, with a concrete protagonist, setting, escalating conflict and a satisfying twist.`
    : `Choose the ONE candidate that will make the most gripping 30-50 second story, scoring each on:
1. A clear protagonist with something at stake.
2. A turning point or reversal.
3. A payoff or twist you can state in one sentence.
4. Visual potential: every beat can be shown as a person doing something somewhere.
5. Advertiser safety: no sexual content, graphic violence, self-harm, or cruelty to children or animals as the focus.
6. Privacy: skip stories whose point depends on identifying a living private individual.
Reject candidates that are commentary, news analysis, questions without a story, or meta posts.`
}

Then write the brief:
- "beats": 5-8 short factual beats in story order${isFiction ? '' : ', using ONLY facts stated in the chosen candidate (never invent details for true stories)'}.
- "twist": the reversal or surprising payoff. "ending": how it resolves.
- "narratorPov": first_person for personal stories (Reddit-style, confessions), third_person for documented events.
- "narratorGender": the narrator's gender (for first person, the author's gender if stated, e.g. "(28F)").
- "tone": 2-4 words, e.g. "petty and triumphant", "eerie and sad".
- "musicMood": one of ${MUSIC_MOODS.join(', ')}.`;

  const contents = candidates
    .map(
      (c, i) => `### Candidate ${i}
TITLE: ${c.title}
SOURCE: ${c.sourceLabel}
TEXT:
${c.bodyText.slice(0, 3500)}${
        c.topComments.length > 0
          ? `\nTOP REACTIONS:\n${c.topComments.map((t) => `- ${t}`).join('\n')}`
          : ''
      }`
    )
    .join('\n\n');

  const response = await generateContentWithFallback({
    model: CONFIG.gemini.editorModel,
    label: 'story-editor',
    contents,
    systemInstruction,
    responseSchema: {
      type: Type.OBJECT,
      required: [
        'chosenIndex',
        'premise',
        'beats',
        'twist',
        'ending',
        'narratorPov',
        'narratorGender',
        'tone',
        'musicMood',
      ],
      properties: {
        chosenIndex: { type: Type.INTEGER },
        premise: { type: Type.STRING, description: 'One-sentence premise' },
        beats: { type: Type.ARRAY, items: { type: Type.STRING } },
        twist: { type: Type.STRING },
        ending: { type: Type.STRING },
        narratorPov: { type: Type.STRING, enum: ['first_person', 'third_person'] },
        narratorGender: { type: Type.STRING, enum: ['male', 'female'] },
        tone: { type: Type.STRING },
        musicMood: { type: Type.STRING, enum: MUSIC_MOODS },
      },
    },
  });

  const parsed = JSON.parse(response.text || '{}');
  const chosen = candidates[Math.min(Math.max(0, parsed.chosenIndex ?? 0), candidates.length - 1)];
  return {
    candidate: chosen,
    premise: parsed.premise,
    beats: parsed.beats,
    twist: parsed.twist,
    ending: parsed.ending,
    // Documented events are always told by an outside narrator, never as an invented "I".
    narratorPov: genre.source === 'wikipedia' ? 'third_person' : parsed.narratorPov,
    narratorGender: parsed.narratorGender,
    tone: parsed.tone,
    musicMood: parsed.musicMood,
  };
}
