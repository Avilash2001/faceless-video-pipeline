import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

/** Opens (creating if needed) the SQLite database at `file`, with the schema in place. */
export function openDatabase(file: string): DatabaseSync {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  database.exec('PRAGMA journal_mode = WAL;');
  initSchema(database);
  return database;
}

function initSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS spend_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item TEXT NOT NULL,
      usd REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_external_id TEXT UNIQUE NOT NULL,
      source_url TEXT NOT NULL,
      niche TEXT NOT NULL,
      hook_archetype TEXT NOT NULL,
      voice_name TEXT NOT NULL,
      strategy_version INTEGER NOT NULL,
      script_json TEXT NOT NULL,
      duration_sec REAL NOT NULL,
      mp4_path TEXT NOT NULL,
      yt_video_id TEXT,
      ig_media_id TEXT,
      fb_video_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS video_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL REFERENCES videos(id),
      snapshot_date TEXT NOT NULL,
      yt_views INTEGER DEFAULT 0,
      yt_avg_view_pct REAL DEFAULT 0,
      yt_likes INTEGER DEFAULT 0,
      yt_comments INTEGER DEFAULT 0,
      yt_shares INTEGER DEFAULT 0,
      ig_plays INTEGER DEFAULT 0,
      ig_avg_watch_pct REAL DEFAULT 0,
      ig_saves INTEGER DEFAULT 0,
      ig_shares INTEGER DEFAULT 0,
      ig_comments INTEGER DEFAULT 0,
      fb_views INTEGER DEFAULT 0,
      fb_avg_watch_pct REAL DEFAULT 0,
      fb_reactions INTEGER DEFAULT 0,
      fb_shares INTEGER DEFAULT 0,
      composite_reward_score REAL DEFAULT 0,
      UNIQUE(video_id, snapshot_date)
    );

    CREATE TABLE IF NOT EXISTS strategy_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL,
      rules_json TEXT NOT NULL,
      critic_summary TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}
