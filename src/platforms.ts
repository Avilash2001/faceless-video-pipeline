import type { Config } from './loadConfig.js';
import type { Storyboard } from './types.js';

/** Every Platform, in the order they are published to and listed. */
export const PLATFORMS = ['youtube', 'instagram', 'facebook'] as const;

/** A service Videos are posted to. */
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_NAMES: Record<Platform, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  facebook: 'Facebook',
};

/** The settings each Platform can't publish without. */
const CREDENTIALS: Record<Platform, (config: Config) => string[]> = {
  youtube: (config) => [config.youtube.clientId, config.youtube.refreshToken],
  instagram: (config) => [config.meta.accessToken, config.meta.igBusinessId],
  facebook: (config) => [config.meta.accessToken, config.meta.fbPageId],
};

/** Whether a Platform's credentials are filled in, rather than empty or still the .env.example placeholder. */
export function isConfigured(platform: Platform, config: Config): boolean {
  return CREDENTIALS[platform](config).every((value) => value && !value.includes('your_'));
}

/** A rendered Video, with the Storyboard its titles, descriptions and tags come from. */
export interface VideoToPublish {
  path: string;
  storyboard: Storyboard;
}

/**
 * How one publish went: the Platform's ID and link for the Post, or the error. The link is missing
 * only when Instagram published the Reel but didn't say where.
 */
export type PublishResult =
  | { platform: Platform; ok: true; id: string; url?: string }
  | { platform: Platform; ok: false; error: string };
