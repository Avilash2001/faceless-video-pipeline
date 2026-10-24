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
      created_at TEXT DEFAULT (datetime('now')),
      -- The Run it was spent in; missing for spend outside a Run, and for spend from before Runs.
      run_id TEXT
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

    -- One row per evolve that changed the strategy.
    CREATE TABLE IF NOT EXISTS strategy_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL,
      rules_json TEXT NOT NULL,
      critic_summary TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      -- The strategy the evolve started from; missing on evolves recorded before it was kept.
      previous_rules_json TEXT
    );

    -- One row each time a condition starts; times are the Daemon's clock, as ISO strings.
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      -- Stable per condition: while it lasts, the same key is the same Alert.
      key TEXT NOT NULL,
      -- What the Alert says now; a rule may change it while the Alert is active.
      text TEXT NOT NULL,
      started_at TEXT NOT NULL,
      -- Missing while the Alert is active.
      cleared_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS alerts_active_key ON alerts(key) WHERE cleared_at IS NULL;

    -- Each push to the operator's phone, kept until it goes out.
    CREATE TABLE IF NOT EXISTS pushes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id INTEGER REFERENCES alerts(id),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      -- When what it reports happened.
      at TEXT NOT NULL,
      -- Set once it has waited through Quiet hours; held pushes go out as one when they end.
      held INTEGER NOT NULL DEFAULT 0,
      -- Missing until it went out; a failed push is tried again at the next check.
      sent_at TEXT
    );
  `);

  addColumnIfMissing(database, 'spend_log', 'run_id TEXT');
  database.exec('CREATE INDEX IF NOT EXISTS spend_log_run ON spend_log(run_id)');
  addColumnIfMissing(database, 'strategy_history', 'previous_rules_json TEXT');
}

/** Adds a column a table made before it existed lacks; `definition` is its name, then its type. */
function addColumnIfMissing(database: DatabaseSync, table: string, definition: string): void {
  const name = definition.split(' ')[0];
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((column) => column.name === name)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}
