import fs from 'fs';
import path from 'path';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { WordTiming } from '../types.js';
import { useEdgeTtsV2Auth } from './edgeTtsAuth.js';

useEdgeTtsV2Auth();

export interface TTSResult {
  audioFilePath: string;
  durationSeconds: number;
  wordTimings: WordTiming[];
}

/**
 * Synthesizes natural neural speech using Microsoft Edge TTS (zero API cost)
 * and extracts exact word-boundary timings for animated karaoke subtitles.
 */
export async function synthesizeSpeechWithTimings(
  text: string,
  voiceName: string,
  rate: string,
  outputDir: string,
  filePrefix: string
): Promise<TTSResult> {
  fs.mkdirSync(outputDir, { recursive: true });
  const audioFilePath = path.join(outputDir, `${filePrefix}_voice.mp3`);

  const tts = new MsEdgeTTS();
  await tts.setMetadata(
    voiceName,
    OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3,
    { wordBoundaryEnabled: true }
  );

  const wordTimings: WordTiming[] = [];
  const { audioStream, metadataStream } = tts.toStream(text, { rate });

  const writeStream = fs.createWriteStream(audioFilePath);

  // Close the WebSocket afterwards; an open socket keeps one-off runs from exiting.
  await new Promise<void>((resolve, reject) => {
    audioStream.pipe(writeStream);

    if (metadataStream) {
      metadataStream.on('data', (chunk: Buffer) => {
        try {
          const payload = JSON.parse(chunk.toString());
          for (const item of payload.Metadata || []) {
            if (item.Type === 'WordBoundary') {
              const offsetMs = Math.round(item.Data.Offset / 10000);
              const durationMs = Math.round(item.Data.Duration / 10000);
              wordTimings.push({
                word: item.Data.text.Text,
                startMs: offsetMs,
                endMs: offsetMs + Math.max(80, durationMs),
              });
            }
          }
        } catch {
          // Ignore partial metadata chunks
        }
      });
    }

    writeStream.on('finish', () => resolve());
    writeStream.on('error', reject);
    audioStream.on('error', reject);
  }).finally(() => tts.close());

  if (wordTimings.length === 0) {
    const words = text.split(/\s+/).filter(Boolean);
    const avgWordMs = 290;
    words.forEach((word, idx) => {
      wordTimings.push({
        word,
        startMs: idx * avgWordMs,
        endMs: (idx + 1) * avgWordMs - 20,
      });
    });
  }

  const lastWord = wordTimings[wordTimings.length - 1];
  const durationSeconds = lastWord ? (lastWord.endMs + 400) / 1000 : 35;

  return {
    audioFilePath,
    durationSeconds,
    wordTimings,
  };
}
