import { GoogleGenAI, Type } from '@google/genai';
import { CONFIG } from '../config.js';
import {
  GeneratedVideoScript,
  HookArchetype,
  RawTrendCandidate,
  StrategyRules,
} from '../types.js';
import { pickWeightedKey } from './trendFinder.js';

const ai = new GoogleGenAI({ apiKey: CONFIG.gemini.apiKey });

/**
 * Transforms a raw trending story + top community reactions into a high-retention,
 * monetizable vertical video script with per-segment visual B-roll cues and
 * platform-tailored metadata for YouTube Shorts, Instagram Reels, and Facebook Reels.
 */
export async function generateTransformativeScript(
  candidate: RawTrendCandidate,
  strategy: StrategyRules
): Promise<GeneratedVideoScript> {
  const chosenHook = pickWeightedKey(
    strategy.hookArchetypeWeights,
    strategy.explorationRate
  ) as HookArchetype;

  const systemPrompt = `You are an elite Short-Form Viral Video Producer & Scriptwriter for YouTube Shorts, Instagram Reels, and Facebook Reels.
Your goal is to transform raw source stories and community reactions into 100% original, high-retention analytical storytelling that passes YouTube Partner Program & Meta Original Content checks.

CURRENT SELF-LEARNED STRATEGY RULES (Version ${strategy.version}):
- Target Duration: ${strategy.targetDurationSeconds.min} to ${strategy.targetDurationSeconds.max} seconds (~95 to 135 spoken words total).
- Assigned Hook Archetype: "${chosenHook}"
- DO RULES:
${strategy.doRules.map((r) => `  * ${r}`).join('\n')}
- DONT RULES:
${strategy.dontRules.map((r) => `  * ${r}`).join('\n')}

CRITICAL PACING REQUIREMENTS:
1. "hookText": Must be under 13 words, spoken in the first 2.5 seconds, creating an immediate curiosity gap.
2. "segments": Break the body into 6 to 8 fast-paced segments (each 12 to 18 words, ~4-5 seconds).
3. Every segment MUST include a concrete 2-4 word "pexelsSearchQuery" for vertical stock B-roll (e.g., "server room red lights", "stressed office worker laptop", "stock market crash screen", "courtroom gavel").
4. Synthesize the original incident WITH the twist or community insight so it adds clear educational/commentary value.
5. "loopBridgeText": A short final clause (4-8 words) that flows seamlessly back into the very first word of "hookText".`;

  const userPrompt = `SOURCE NICHE: ${candidate.niche}
SOURCE TITLE: ${candidate.title}
SOURCE BODY:
${candidate.bodyText}

TOP COMMUNITY REACTIONS / INSIGHTS:
${candidate.topComments.map((c, i) => `[Comment ${i + 1}]: ${c}`).join('\n\n')}`;

  const response = await ai.models.generateContent({
    model: CONFIG.gemini.model,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        required: [
          'titleCardBadge',
          'titleCardHeadline',
          'hookText',
          'segments',
          'loopBridgeText',
          'youtubeMetadata',
          'instagramMetadata',
          'facebookMetadata',
        ],
        properties: {
          titleCardBadge: {
            type: Type.STRING,
            description: 'Short uppercase category badge (2-3 words, e.g. TECH POST-MORTEM)',
          },
          titleCardHeadline: {
            type: Type.STRING,
            description: 'Punchy 6-9 word headline for the opening 2.5s visual card',
          },
          hookText: {
            type: Type.STRING,
            description: 'First 2.5 seconds spoken hook (max 13 words)',
          },
          segments: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: [
                'segmentIndex',
                'spokenText',
                'onScreenHeadline',
                'pexelsSearchQuery',
                'sfxCue',
              ],
              properties: {
                segmentIndex: { type: Type.INTEGER },
                spokenText: { type: Type.STRING },
                onScreenHeadline: { type: Type.STRING },
                pexelsSearchQuery: { type: Type.STRING },
                sfxCue: {
                  type: Type.STRING,
                  enum: ['whoosh', 'pop', 'riser', 'none'],
                },
              },
            },
          },
          loopBridgeText: {
            type: Type.STRING,
            description: 'Final 4-8 words that grammatically connect back to hookText',
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
              firstCommentPrompt: {
                type: Type.STRING,
                description: 'A polarizing question to pin in comments to boost IG algorithm',
              },
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
    },
  });

  const parsed = JSON.parse(response.text || '{}');
  const fullNarrationText = [
    parsed.hookText,
    ...parsed.segments.map((s: any) => s.spokenText),
    parsed.loopBridgeText,
  ].join(' ');

  return {
    niche: candidate.niche,
    hookArchetype: chosenHook,
    titleCardBadge: parsed.titleCardBadge,
    titleCardHeadline: parsed.titleCardHeadline,
    hookText: parsed.hookText,
    segments: parsed.segments,
    loopBridgeText: parsed.loopBridgeText,
    fullNarrationText,
    youtubeMetadata: parsed.youtubeMetadata,
    instagramMetadata: parsed.instagramMetadata,
    facebookMetadata: parsed.facebookMetadata,
  };
}
