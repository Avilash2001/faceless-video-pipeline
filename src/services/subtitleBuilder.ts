import fs from 'fs';
import path from 'path';
import { WordTiming } from '../types.js';

// Active-word highlight colours (ASS &HBBGGRR&): gold, cyan, lime, hot pink. Rotated per
// video so consecutive uploads don't look templated.
const HIGHLIGHT_COLOURS = ['&H0000EAFF&', '&H00FFE100&', '&H0000FF9D&', '&H00B469FF&'];

/**
 * Generates an Advanced SubStation Alpha (.ass) subtitle file with:
 * 1. A hook overlay (0.0s - 2.6s): 3-6 big words over the first frame, upper third.
 * 2. 3-word pop-in karaoke chunks with a rotating active-word highlight colour,
 *    thick black stroke outline, and vertical safe-zone positioning (MarginV=460)
 *    so captions sit cleanly above YT Shorts, IG Reels, and FB Reels UI overlays.
 */
export function buildAssSubtitles(
  wordTimings: WordTiming[],
  outputDir: string,
  filePrefix: string,
  hookOverlayText?: string
): string {
  const assPath = path.join(outputDir, `${filePrefix}_captions.ass`);
  const highlight = HIGHLIGHT_COLOURS[Math.floor(Math.random() * HIGHLIGHT_COLOURS.length)];

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: KaraokePop,Arial Black,78,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,7,3,2,80,80,460,1
Style: HookOverlay,Arial Black,96,&H00FFFFFF,&H00FFFFFF,&H00000000,&H99000000,-1,0,0,0,100,100,1,0,1,9,4,8,70,70,330,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events: string[] = [];

  if (hookOverlayText) {
    events.push(
      `Dialogue: 1,0:00:00.00,0:00:02.60,HookOverlay,,0,0,0,,{\\fad(0,200)\\fscx112\\fscy112\\t(0,180,\\fscx100\\fscy100)}${sanitizeAssText(hookOverlayText.toUpperCase())}`
    );
  }

  const chunkSize = 3;

  for (let i = 0; i < wordTimings.length; i += chunkSize) {
    const chunk = wordTimings.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;

    for (let activeIdx = 0; activeIdx < chunk.length; activeIdx++) {
      const currentWord = chunk[activeIdx];
      const nextWord = chunk[activeIdx + 1];

      const startAss = formatAssTimestamp(currentWord.startMs);
      const endAss = formatAssTimestamp(
        nextWord ? nextWord.startMs : currentWord.endMs
      );

      const formattedChunk = chunk
        .map((w, idx) => {
          const clean = sanitizeAssText(w.word.toUpperCase());
          if (idx === activeIdx) {
            return `{\\c${highlight}\\fscx108\\fscy108}${clean}{\\c&H00FFFFFF&\\fscx100\\fscy100}`;
          }
          return clean;
        })
        .join(' ');

      events.push(
        `Dialogue: 0,${startAss},${endAss},KaraokePop,,0,0,0,,{\\fad(35,0)}${formattedChunk}`
      );
    }
  }

  fs.writeFileSync(assPath, header + events.join('\n') + '\n', 'utf-8');
  return assPath;
}

function formatAssTimestamp(ms: number): string {
  const totalCs = Math.max(0, Math.floor(ms / 10));
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hr = Math.floor(totalMin / 60);

  return `${hr}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function sanitizeAssText(text: string): string {
  return text.replace(/[{}]/g, '').trim();
}
