import { CharacterSpec, Storyboard, StoryScene } from '../types.js';

const NO_TEXT = 'No text, letters, captions, signs, logos or watermarks anywhere in the image.';
const ORDINALS = ['first', 'second', 'third', 'fourth'];

/** Name-free label for a character; older storyboards without a role get an ordinal one. */
function roleOf(character: CharacterSpec, storyboard: Storyboard): string {
  const i = storyboard.characters.indexOf(character);
  return character.role?.trim() || `the ${ORDINALS[i] || 'other'} character`;
}

/**
 * Image models refuse named real people, so image and motion prompts never carry names:
 * character ids and any full name or surname that slipped into the text become the role.
 */
export function imageSafe(text: string, storyboard: Storyboard): string {
  let out = text;
  for (const c of storyboard.characters) {
    const role = roleOf(c, storyboard);
    out = out.replace(new RegExp(`\\b${c.id}\\b`, 'g'), role);
    const names = [c.name, c.name.split(/\s+/).pop() || ''].filter((n) => n.length >= 4);
    for (const name of names) {
      out = out.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), role);
    }
  }
  return out;
}

/**
 * One reference image for the whole cast (cheaper than a sheet per character): everyone
 * standing side by side, full body, in story order from left to right.
 */
export function castSheetPrompt(storyboard: Storyboard): string {
  const cast = storyboard.characters;
  const people =
    cast.length === 1
      ? `${roleOf(cast[0], storyboard)}: ${cast[0].appearance}. Show a full-body front view and a head-and-shoulders portrait side by side.`
      : `${cast.length} people standing side by side, full body, front view, evenly spaced, from left to right: ${cast
          .map((c, i) => `(${i + 1}) ${roleOf(c, storyboard)}: ${c.appearance}`)
          .join('; ')}.`;
  return [
    `Character reference sheet for an illustrated story with fictional-looking stylized characters. ${people}`,
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
  const sheetOrder = storyboard.characters.map((c) => roleOf(c, storyboard)).join(', ');
  const castLine =
    cast.length === 0
      ? ''
      : `Characters in this frame: ${cast.map((c) => `${roleOf(c, storyboard)} (${c.appearance})`).join('; ')}.` +
        (withRefs
          ? storyboard.characters.length === 1
            ? ` The attached reference image shows ${roleOf(cast[0], storyboard)}; match their face, hair and clothing exactly.`
            : ` The attached reference sheet shows, from left to right, ${sheetOrder}; match each person in this frame to the sheet exactly (face, hair, clothing).`
          : '');

  return [
    imageSafe(scene.visualPrompt, storyboard),
    castLine,
    `Art style: ${storyboard.visualStyle.prompt}.`,
    'Vertical 9:16 frame, main subject in the upper two-thirds, cinematic composition.',
    NO_TEXT,
  ]
    .filter(Boolean)
    .join('\n');
}
