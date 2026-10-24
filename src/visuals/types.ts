import { ImageProviderName, MotionProviderName } from '../config.js';

export interface ImageJob {
  prompt: string;
  /** Local paths of character reference sheets to keep people consistent. */
  refImages: string[];
  aspectRatio: '9:16' | '1:1' | '16:9';
  seed: number;
  /** Output path without extension; the provider adds the right one. */
  outBase: string;
  /** Used by the stock provider instead of the full prompt. */
  stockQuery?: string;
}

export interface GeneratedMedia {
  path: string;
  kind: 'image' | 'video';
}

export interface ImageProvider {
  name: ImageProviderName;
  /** Rough per-image cost for the run's cost log; 0 for local/free. */
  costPerImageUsd: number;
  /** Whether generate() can use reference images. */
  supportsRefs: boolean;
  generate(job: ImageJob): Promise<GeneratedMedia>;
}

export interface MotionJob {
  imagePath: string;
  prompt: string;
  /** Requested clip length; providers round to what they support. */
  seconds: number;
  seed: number;
  outBase: string;
}

export interface MotionProvider {
  name: MotionProviderName;
  costPerSecondUsd: number;
  /** Seconds the provider bills for a requested clip length. */
  billedSeconds(seconds: number): number;
  animate(job: MotionJob): Promise<string>;
}
