import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';

/**
 * Synthesizes the three SFX cues the storyboard uses (whoosh, impact, riser) into
 * assets/sfx/ as 44.1 kHz mono WAVs. Pure DSP: free, license-free, reproducible.
 *   npm run make-sfx
 */

const RATE = 44100;

/** RBJ band-pass biquad with a centre frequency that can change every sample. */
function bandpass(input: Float32Array, freqAt: (t: number) => number, q: number): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const w0 = (2 * Math.PI * freqAt(i / RATE)) / RATE;
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    const b0 = alpha / a0, b2 = -alpha / a0;
    const a1 = (-2 * Math.cos(w0)) / a0, a2 = (1 - alpha) / a0;
    const y = b0 * input[i] + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = input[i]; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

/** Deterministic white noise so the files come out identical on every machine. */
function noise(seconds: number, seed = 1): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  let s = seed;
  for (let i = 0; i < out.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = s / 0xffffffff * 2 - 1;
  }
  return out;
}

function normalize(samples: Float32Array, peakDb = -3): Float32Array {
  const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  const gain = Math.pow(10, peakDb / 20) / peak;
  return samples.map((v) => v * gain);
}

function whoosh(): Float32Array {
  const dur = 0.75;
  const filtered = bandpass(noise(dur, 7), (t) => 350 + 2600 * Math.sin((Math.PI * t) / dur), 1.4);
  return filtered.map((v, i) => {
    const t = i / RATE;
    const env = t < 0.28 ? Math.pow(t / 0.28, 2) : Math.exp(-(t - 0.28) * 7);
    return v * env;
  });
}

function impact(): Float32Array {
  const dur = 1.3;
  const n = Math.round(dur * RATE);
  const thump = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    phase += (2 * Math.PI * (38 + 52 * Math.exp(-t * 9))) / RATE; // pitch drops 90 Hz → 38 Hz
    thump[i] = Math.sin(phase) * Math.exp(-t * 3.2);
  }
  const crack = bandpass(noise(dur, 3), () => 900, 0.7).map((v, i) => v * Math.exp(-(i / RATE) * 45) * 0.6);
  // Gentle saturation gives the hit some weight on phone speakers.
  return thump.map((v, i) => Math.tanh((v + crack[i]) * 1.8));
}

function riser(): Float32Array {
  const dur = 1.6;
  const swept = bandpass(noise(dur, 11), (t) => 300 * Math.pow(14, t / dur), 2.2);
  let phase = 0;
  return swept.map((v, i) => {
    const t = i / RATE;
    phase += (2 * Math.PI * (220 * Math.pow(4, t / dur))) / RATE;
    const env = Math.pow(t / dur, 2.2) * (t > dur - 0.03 ? (dur - t) / 0.03 : 1);
    return (v + Math.sin(phase) * 0.12) * env;
  });
}

function writeWav(file: string, samples: Float32Array): void {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-1, Math.min(1, v)) * 32767, i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

fs.mkdirSync(CONFIG.paths.sfxDir, { recursive: true });
for (const [name, make] of [
  ['whoosh', whoosh],
  ['impact', impact],
  ['riser', riser],
] as const) {
  const file = path.join(CONFIG.paths.sfxDir, `${name}.wav`);
  writeWav(file, normalize(make()));
  console.log(`[SFX] Wrote ${file}`);
}
