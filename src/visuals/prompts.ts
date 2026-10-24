import { CharacterSpec, Storyboard, StoryScene } from '../types.js';

const NO_TEXT = 'No text, letters, captions, signs, logos or watermarks anywhere in the image.';

/**
 * One reference image for the whole cast (cheaper than a sheet per character): everyone
 * standing side by side, full body, in story order from left to right.
 */
export function castSheetPrompt(storyboard: Storyboard): string {
  const cast = storyboard.characters;
  const people =
    cast.length === 1
      ? `${cast[0].name}, ${cast[0].appearance}. Show a full-body front view and a head-and-shoulders portrait side by side.`
      : `${cast.length} people standing side by side, full body, front view, evenly spaced, from left to right: ${cast
          .map((c, i) => `(${i + 1}) ${c.name}, ${c.appearance}`)
          .join('; ')}.`;
  return [
    `Character reference sheet for an illustrated story. ${people}`,
    'Plain light-gray background, even soft lighting, neutral expressions, nobody overlapping.',
    `Art style: ${storyboard.visualStyle.prompt}.`,
    NO_TEXT,
  ].join(' ');
}

/** Characters in a scene, in story order. */
export function sceneCharacters(scene: StoryScene, storyboard: Storyboard): CharacterSpec[] {
  return storyboard.characters.filter((c) => scene.characterIds.includes(c.id));
}

export function scenePrompt(scene: StoryScene, storyboard: Storyboard, withRefs: boolean): string {
  const cast = sceneCharacters(scene, storyboard);
  let visual = scene.visualPrompt;
  for (const c of storyboard.characters) {
    visual = visual.replace(new RegExp(`\\b${c.id}\\b`, 'g'), c.name);
  }

  const sheetOrder = storyboard.characters.map((c) => c.name).join(', ');
  const castLine =
    cast.length === 0
      ? ''
      : `Characters in this frame: ${cast.map((c) => `${c.name} (${c.appearance})`).join('; ')}.` +
        (withRefs
          ? storyboard.characters.length === 1
            ? ` The attached reference image shows ${cast[0].name}; match their face, hair and clothing exactly.`
            : ` The attached reference sheet shows, from left to right, ${sheetOrder}; match each person in this frame to the sheet exactly (face, hair, clothing).`
          : '');

  return [
    visual,
    castLine,
    `Art style: ${storyboard.visualStyle.prompt}.`,
    'Vertical 9:16 frame, main subject in the upper two-thirds, cinematic composition.',
    NO_TEXT,
  ]
    .filter(Boolean)
    .join('\n');
}
