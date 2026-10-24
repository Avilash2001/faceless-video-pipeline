import { CharacterSpec, Storyboard, StoryScene } from '../types.js';

const NO_TEXT = 'No text, letters, captions, signs, logos or watermarks anywhere in the image.';

export function characterSheetPrompt(character: CharacterSpec, storyboard: Storyboard): string {
  return [
    `Character reference sheet for an illustrated story: ${character.name}, ${character.appearance}.`,
    'Show the same person twice side by side: a full-body front view and a head-and-shoulders portrait.',
    'Plain light-gray background, even soft lighting, neutral expression.',
    `Art style: ${storyboard.visualStyle.prompt}.`,
    NO_TEXT,
  ].join(' ');
}

/** Characters in a scene, in the same order their reference sheets are attached. */
export function sceneCharacters(scene: StoryScene, storyboard: Storyboard): CharacterSpec[] {
  return storyboard.characters.filter((c) => scene.characterIds.includes(c.id));
}

export function scenePrompt(scene: StoryScene, storyboard: Storyboard, withRefs: boolean): string {
  const cast = sceneCharacters(scene, storyboard);
  let visual = scene.visualPrompt;
  for (const c of storyboard.characters) {
    visual = visual.replace(new RegExp(`\\b${c.id}\\b`, 'g'), c.name);
  }

  const castLine =
    cast.length === 0
      ? ''
      : `Characters in this frame: ${cast.map((c) => `${c.name} (${c.appearance})`).join('; ')}.` +
        (withRefs
          ? ` The attached reference images show, in order, ${cast.map((c) => c.name).join(', ')}; match each person's face, hair and clothing exactly.`
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
