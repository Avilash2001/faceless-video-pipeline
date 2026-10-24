import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import type { AlertRule } from './alerts.js';

/**
 * Keys `.env.example` has that `.env` lacks, or leaves empty where `.env.example` fills them in.
 * A key `.env.example` leaves empty is optional, so leaving it empty in `.env` is fine. Both files
 * are read afresh each time, so filling a key in clears it without a restart.
 */
export function missingEnvKeys(root: string): string[] {
  const example = readEnvFile(path.join(root, '.env.example'));
  const env = readEnvFile(path.join(root, '.env'));
  return Object.keys(example).filter((key) => !(key in env) || (example[key] !== '' && env[key] === ''));
}

export function missingEnvKeysRule(root: string): AlertRule {
  return () => {
    const missing = missingEnvKeys(root);
    if (missing.length === 0) return [];
    return [{ key: 'env-missing-keys', text: `Keys missing or empty in .env: ${missing.join(', ')}` }];
  };
}

function readEnvFile(file: string): Record<string, string> {
  return fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
}
