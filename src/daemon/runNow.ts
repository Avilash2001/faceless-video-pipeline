import { GENRES } from '../genres.js';
import { IMAGE_PROVIDER_NAMES, MOTION_PROVIDER_NAMES } from '../loadConfig.js';
import type { NicheCategory, RunOptions } from '../types.js';

/** Posted along with the options by the over-budget warning, to start the Run anyway. */
export const RUN_ANYWAY = 'run-anyway';

/** A Run now form choosing something it doesn't offer. */
export class UnknownOptionError extends Error {}

/**
 * The options chosen in the Run now form, whose fields are named after the command line's flags;
 * whatever is left unchosen stays at its default. Throws UnknownOptionError for a Genre or
 * Provider the form doesn't offer.
 */
export function runNowOptions(form: Record<string, string | File>): RunOptions {
  const options: RunOptions = {};
  const genre = chosen(form.genre, Object.keys(GENRES) as NicheCategory[], 'Genre');
  if (genre) options.genre = genre;
  const imageProvider = chosen(form.images, IMAGE_PROVIDER_NAMES, 'image Provider');
  if (imageProvider) options.imageProvider = imageProvider;
  const motionProvider = chosen(form.motion, MOTION_PROVIDER_NAMES, 'motion Provider');
  if (motionProvider) options.motionProvider = motionProvider;
  if (form['storyboard-only']) options.storyboardOnly = true;
  if (form['no-upload']) options.upload = false;
  return options;
}

/** The Run now form's fields that choose `options`: what runNowOptions reads back. */
export function runNowFields(options: RunOptions): Record<string, string> {
  const fields: Record<string, string> = {};
  if (options.genre) fields.genre = options.genre;
  if (options.imageProvider) fields.images = options.imageProvider;
  if (options.motionProvider) fields.motion = options.motionProvider;
  if (options.storyboardOnly) fields['storyboard-only'] = 'on';
  if (options.upload === false) fields['no-upload'] = 'on';
  return fields;
}

/** The choice in a select, or undefined when it was left at its default. */
function chosen<T extends string>(value: string | File | undefined, offered: readonly T[], what: string): T | undefined {
  if (!value) return undefined;
  if (!offered.includes(value as T)) throw new UnknownOptionError(`Unknown ${what} "${value}".`);
  return value as T;
}
