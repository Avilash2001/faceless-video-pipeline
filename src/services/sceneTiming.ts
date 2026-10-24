import { StoryScene, TimedScene, WordTiming } from '../types.js';

const norm = (w: string) =>
  w
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '');

const tokens = (text: string) => text.split(/[\s—-]+/).map(norm).filter(Boolean);

const loosely = (a: string | undefined, b: string | undefined) =>
  Boolean(a && b) && (a === b || (a!.length >= 3 && b!.length >= 3 && (a!.startsWith(b!) || b!.startsWith(a!))));

/**
 * Finds where each scene starts in the TTS word timings by matching the scene's first
 * two words, searching forward from the previous scene. Unmatched scenes are interpolated
 * by character count between matched neighbours. Scene 1 always starts at 0.
 */
export function alignScenesToTimings(
  scenes: StoryScene[],
  timings: WordTiming[],
  totalMs: number
): TimedScene[] {
  const spoken = timings.flatMap((t) => tokens(t.word).map((tok) => ({ tok, startMs: t.startMs })));
  const starts: (number | undefined)[] = new Array(scenes.length).fill(undefined);
  starts[0] = 0;

  let cursor = 0;
  scenes.forEach((scene, i) => {
    const words = tokens(scene.narration);
    if (i > 0 && words.length > 0) {
      for (let k = cursor; k < Math.min(spoken.length, cursor + 14); k++) {
        if (loosely(spoken[k].tok, words[0]) && (words.length < 2 || loosely(spoken[k + 1]?.tok, words[1]))) {
          starts[i] = spoken[k].startMs;
          cursor = k;
          break;
        }
      }
    }
    // Jump close to the end of this scene so the next search can't match inside it.
    cursor += Math.max(1, words.length - 2);
  });

  // Interpolate gaps by narration length between known anchors.
  const weights = scenes.map((s) => Math.max(1, s.narration.length));
  for (let i = 1; i < scenes.length; i++) {
    if (starts[i] !== undefined) continue;
    const prev = i - 1;
    let next = i;
    while (next < scenes.length && starts[next] === undefined) next++;
    const from = starts[prev]!;
    const to = next < scenes.length ? starts[next]! : totalMs;
    const span = weights.slice(prev, next).reduce((a, b) => a + b, 0);
    let acc = 0;
    for (let j = prev; j < next - 1; j++) {
      acc += weights[j];
      starts[j + 1] = Math.round(from + ((to - from) * acc) / span);
    }
  }

  return scenes.map((scene, i) => ({
    ...scene,
    startMs: starts[i]!,
    endMs: i + 1 < scenes.length ? starts[i + 1]! : totalMs,
  }));
}
