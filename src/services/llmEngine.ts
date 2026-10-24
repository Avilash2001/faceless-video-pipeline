import { Type } from '@google/genai';
import { CONFIG } from '../config.js';
import { GENRES, VISUAL_STYLES } from '../genres.js';
import { pickRandom, pickWeightedKey } from '../sources/util.js';
import { HookArchetype, StoryBrief, Storyboard, StrategyRules } from '../types.js';
import { generateContentWithFallback } from './gemini.js';

const HOOK_GUIDES: Record<HookArchetype, string> = {
  cold_open_climax: 'Drop the viewer into the most dramatic moment, then rewind ("Three weeks earlier...").',
  shocking_confession: 'Open with a blunt first-person confession that demands an explanation.',
  impossible_question: 'Open with a question that sounds impossible but the story answers.',
  stakes_reveal: 'Open by stating exactly what was at stake and how close it came to being lost.',
  twist_tease: 'Open by promising a specific twist without revealing it.',
};

// Edge TTS at roughly +10% speaks ~2.7 words per second.
const WORDS_PER_SECOND = 2.7;

/**
 * Turns a story brief into a narrated storyboard: one short narration line per scene, each
 * with a concrete visual prompt, camera move and SFX cue, plus a consistent cast and art style.
 */
export async function generateStoryboard(
  brief: StoryBrief,
  strategy: StrategyRules
): Promise<Storyboard> {
  const niche = brief.candidate.niche;
  const genre = GENRES[niche];
  const isFiction = genre.source === 'fiction';
  const hook = pickWeightedKey(strategy.hookArchetypeWeights, strategy.explorationRate);
  const styleName = pickRandom(genre.styles);
  const minWords = Math.round(strategy.targetDurationSeconds.min * WORDS_PER_SECOND);
  const maxWords = Math.round(strategy.targetDurationSeconds.max * WORDS_PER_SECOND);

  const sourceRules =
    genre.source === 'reddit'
      ? `- This is adapted from ${brief.candidate.sourceLabel}. Retell it as an ORIGINAL first-person story in your own words: change every name and identifying detail, condense, never reuse the author's sentences.`
      : genre.source === 'wikipedia'
        ? `- This is a TRUE documented story. Use only the facts in the brief. Never invent names, numbers, dialogue or events. Third person.`
        : `- This is ORIGINAL FICTION. Never imply it is real or that it came from Reddit.`;

  const systemInstruction = `You are an elite short-form story writer and storyboard artist. You write narrated stories for vertical video that people watch to the end and replay.

STRATEGY (v${strategy.version}):
- Length: ${minWords}-${maxWords} spoken words in total.
- Hook archetype "${hook}": ${HOOK_GUIDES[hook]}
- DO:
${strategy.doRules.map((r) => `  * ${r}`).join('\n')}
- DON'T:
${strategy.dontRules.map((r) => `  * ${r}`).join('\n')}
${sourceRules}

NARRATION:
- Narrator: ${brief.narratorPov.replace('_', ' ')}, ${brief.narratorGender}, tone "${brief.tone}".
- 9 to 14 scenes. Each scene's "narration" is ONE short line (5-14 words) that gets its own image, so the visual changes every 2-4 seconds.
- Scene 1 is the hook: 10 words or fewer.
- Build: setup, complication, a reversal around the middle, the turn, then the payoff in the last 20%.
- The final scene is the payoff: ONE complete, satisfying sentence that resolves the story and answers the hook. It may echo the hook's words so a replay feels like a loop, but it must make sense on its own: never end mid-sentence, on a word like "that", "when" or "because", with an ellipsis, or on a cliffhanger.
- Plain spoken English. No emojis, hashtags, stage directions or speaker labels in narration.
- Narration uses names or pronouns, NEVER character ids like "C1" (ids are only for visual prompts).

VISUALS (art style "${styleName}": ${VISUAL_STYLES[styleName]}):
- "visualPrompt": a concrete single frame showing exactly what that line describes: subject + action + setting + shot type + lighting + mood, with the subject in the upper two-thirds (captions sit at the bottom). Don't restate the art style or aspect ratio; they're added automatically.
- Refer to recurring people ONLY by their character id (e.g. "C1 slams the door") and list them in "characterIds"; their appearance is injected automatically.
- NEVER write a real person's name (or any name) in "visualPrompt" or "motionPrompt": image models refuse named real people. Use character ids or generic descriptions ("a famous striker").
- Never ask for text, letters, signs, logos, watermarks or UI in the image.
- ${isFiction || genre.source === 'reddit' ? 'Characters are invented people.' : 'Real people are depicted as stylized illustrations, never photorealistic likenesses.'}
- "characters": 1-3 recurring people with a fixed visual description (age, build, hair, skin tone, clothing, one distinctive detail) and a "role": a short generic label with no name (e.g. "the young footballer", "the HOA president").
- "sameShotAsPrevious": true when a line continues the exact same moment and place as the previous scene, so its image is reused with a different camera move. Aim for 7-9 distinct images in total. Never true for scene 1, the reversal, or the final payoff.
- "camera": vary it; use push_in for tension, pull_out for reveals, pans for movement. A reused shot must use a different camera move than the scene before it.
- "sfx": whoosh on a location or time jump, impact on the reversal, riser just before the twist, otherwise none.
- Mark exactly 2 scenes as "motionCandidate": the hook and the climax. Their "motionPrompt" describes the motion for an image-to-video model (subject movement + camera move, 1 sentence). Other scenes: motionCandidate false and motionPrompt "".
- "hookOverlayText": 3-6 punchy words shown over the first frame (no question marks needed, no emojis).

METADATA:
- YouTube title under 70 characters that creates curiosity without lying. Description: 2 short sentences, no hashtags (sources are appended automatically). 5-10 tags.
- Instagram caption with at most 5 hashtags. "firstCommentPrompt": a debate question for the comments.
- Facebook title and 1-2 sentence description.`;

  const userPrompt = `STORY BRIEF
Premise: ${brief.premise}
Beats:
${brief.beats.map((b, i) => `${i + 1}. ${b}`).join('\n')}
Twist: ${brief.twist}
Ending: ${brief.ending}`;

  const response = await generateContentWithFallback({
    label: 'storyboard',
    contents: userPrompt,
    systemInstruction,
    responseSchema: {
      type: Type.OBJECT,
      required: [
        'hookOverlayText',
        'characters',
        'scenes',
        'youtubeMetadata',
        'instagramMetadata',
        'facebookMetadata',
      ],
      properties: {
        hookOverlayText: { type: Type.STRING },
        characters: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            required: ['id', 'name', 'role', 'appearance'],
            properties: {
              id: { type: Type.STRING, description: 'C1, C2, C3' },
              name: { type: Type.STRING },
              role: { type: Type.STRING, description: 'Generic label without any name, e.g. "the young footballer"' },
              appearance: { type: Type.STRING },
            },
          },
        },
        scenes: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            required: [
              'narration',
              'visualPrompt',
              'stockQuery',
              'characterIds',
              'sameShotAsPrevious',
              'camera',
              'sfx',
              'motionCandidate',
              'motionPrompt',
            ],
            properties: {
              narration: { type: Type.STRING },
              visualPrompt: { type: Type.STRING },
              stockQuery: {
                type: Type.STRING,
                description: '2-4 word stock footage search, e.g. "bank vault door"',
              },
              characterIds: { type: Type.ARRAY, items: { type: Type.STRING } },
              sameShotAsPrevious: { type: Type.BOOLEAN },
              camera: {
                type: Type.STRING,
                enum: ['push_in', 'pull_out', 'pan_left', 'pan_right', 'pan_up', 'pan_down'],
              },
              sfx: { type: Type.STRING, enum: ['whoosh', 'impact', 'riser', 'none'] },
              motionCandidate: { type: Type.BOOLEAN },
              motionPrompt: { type: Type.STRING },
            },
          },
        },
        youtubeMetadata: {
          type: Type.OBJECT,
          required: ['title', 'description', 'tags'],
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
        },
        instagramMetadata: {
          type: Type.OBJECT,
          required: ['caption', 'firstCommentPrompt'],
          properties: {
            caption: { type: Type.STRING },
            firstCommentPrompt: { type: Type.STRING },
          },
        },
        facebookMetadata: {
          type: Type.OBJECT,
          required: ['title', 'description'],
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
          },
        },
      },
    },
  });

  const parsed = JSON.parse(response.text || '{}');
  const scenes = (parsed.scenes || []).map((s: any, index: number) => ({
    ...s,
    index,
    sameShotAsPrevious: index > 0 && Boolean(s.sameShotAsPrevious),
  }));
  if (scenes.length < 3) {
    throw new Error(`Storyboard came back with ${scenes.length} scenes; expected 9-14.`);
  }

  const sourceUrls = brief.candidate.sourceUrl ? [brief.candidate.sourceUrl] : [];
  const creditLine = isFiction
    ? 'An original story. All characters and events are fictional.'
    : genre.source === 'reddit'
      ? `Inspired by ${brief.candidate.sourceLabel}. Names and details changed.`
      : `Based on documented events. Source: ${brief.candidate.sourceLabel}.`;

  return ensureCleanEnding({
    niche,
    hookArchetype: hook,
    isFiction,
    sourceUrls,
    creditLine,
    hookOverlayText: parsed.hookOverlayText,
    visualStyle: { name: styleName, prompt: VISUAL_STYLES[styleName] },
    characters: parsed.characters || [],
    scenes,
    musicMood: brief.musicMood,
    narratorGender: brief.narratorGender,
    fullNarrationText: scenes.map((s: any) => s.narration).join(' '),
    youtubeMetadata: parsed.youtubeMetadata,
    instagramMetadata: parsed.instagramMetadata,
    facebookMetadata: parsed.facebookMetadata,
  });
}

// Words a finished sentence can't end on.
const DANGLING_WORD =
  /^(that|when|because|where|which|who|whom|whose|and|but|so|or|until|while|how|why|what|if|as|to|the|a|an|of|with|for|than|then|proving|showing|meaning)$/i;

function lastWord(line: string): string {
  return (
    line
      .trim()
      .replace(/[.!?"'\u201d\u2019)]+$/, '')
      .split(/\s+/)
      .pop() || ''
  );
}

export function endsCleanly(line: string): boolean {
  const t = line.trim();
  if (/(\.\.\.|\u2026)["'\u201d\u2019)]*$/.test(t)) return false;
  if (!/[.!?]["'\u201d\u2019)]*$/.test(t)) return false;
  return !DANGLING_WORD.test(lastWord(t));
}

/** Last resort: drop a trailing clause that ends on a dangling word and close the sentence. */
function trimDangling(line: string): string {
  let t = line.trim().replace(/(\.\.\.|\u2026)$/, '').replace(/[,;:\s]+$/, '');
  if (DANGLING_WORD.test(lastWord(t)) && t.includes(',')) t = t.slice(0, t.lastIndexOf(','));
  while (t.includes(' ') && DANGLING_WORD.test(lastWord(t))) t = t.slice(0, t.lastIndexOf(' '));
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * Guarantees the story ends on a complete sentence: an abrupt final line ("proving that...")
 * is rewritten by a cheap model call, or trimmed to its last complete clause if that fails.
 */
export async function ensureCleanEnding(storyboard: Storyboard): Promise<Storyboard> {
  const last = storyboard.scenes[storyboard.scenes.length - 1];
  if (endsCleanly(last.narration)) return storyboard;
  console.warn(`[Storyboard] Final line ends abruptly ("${last.narration}"); rewriting it.`);

  let fixed: string | undefined;
  try {
    const response = await generateContentWithFallback({
      model: CONFIG.gemini.editorModel,
      label: 'ending-fix',
      contents: `STORY:\n${storyboard.scenes
        .slice(0, -1)
        .map((s) => s.narration)
        .join('\n')}\n\nCUT-OFF FINAL LINE: ${last.narration}`,
      systemInstruction:
        'Rewrite only the final line of this narrated short story as ONE complete, satisfying sentence of 6-16 words that resolves the story. Keep the same narrator voice. It may echo the opening line. No ellipsis, no cliffhanger, no question.',
      responseSchema: {
        type: Type.OBJECT,
        required: ['finalLine'],
        properties: { finalLine: { type: Type.STRING } },
      },
    });
    fixed = JSON.parse(response.text || '{}').finalLine;
  } catch (err) {
    console.warn('[Storyboard] Ending rewrite failed:', (err as Error).message);
  }

  last.narration = fixed && endsCleanly(fixed) ? fixed.trim() : trimDangling(last.narration);
  storyboard.fullNarrationText = storyboard.scenes.map((s) => s.narration).join(' ');
  return storyboard;
}
