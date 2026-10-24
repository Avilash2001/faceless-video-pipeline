import { CONFIG } from '../config.js';
import { openDatabase } from './open.js';

export const db = openDatabase(CONFIG.paths.dbFile);

export function isSourceAlreadyProcessed(externalId: string): boolean {
  const row = db
    .prepare('SELECT 1 FROM videos WHERE source_external_id = ?')
    .get(externalId);
  return Boolean(row);
}

/** YouTube titles of the most recent videos, so new stories avoid repeating them. */
export function getRecentStoryTitles(limit: number): string[] {
  const rows = db
    .prepare('SELECT script_json FROM videos ORDER BY id DESC LIMIT ?')
    .all(limit) as { script_json: string }[];
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.script_json)?.youtubeMetadata?.title as string | undefined;
      } catch {
        return undefined;
      }
    })
    .filter((t): t is string => Boolean(t));
}
