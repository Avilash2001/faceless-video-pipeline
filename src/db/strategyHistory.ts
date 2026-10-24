import type { DatabaseSync } from 'node:sqlite';
import type { StrategyRules } from '../types.js';

/** One evolve that changed the strategy: the version it started from, the one it wrote, and why. */
export interface Evolve {
  from: StrategyRules;
  to: StrategyRules;
  criticSummary: string;
  at: Date;
}

/** An evolve as recorded; evolves recorded before the version they started from was kept have no `from`. */
export type RecordedEvolve = Omit<Evolve, 'from'> & { from?: StrategyRules };

interface EvolveRow {
  rules_json: string;
  previous_rules_json: string | null;
  critic_summary: string;
  created_at: string;
}

/** Records an evolve once its strategy has been written to the strategy file. */
export function recordEvolve(database: DatabaseSync, { from, to, criticSummary, at }: Evolve): void {
  database
    .prepare(
      `INSERT INTO strategy_history (version, rules_json, previous_rules_json, critic_summary, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(to.version, JSON.stringify(to), JSON.stringify(from), criticSummary, toSqliteTime(at));
}

/** Every recorded evolve, newest first. */
export function evolveHistory(database: DatabaseSync): RecordedEvolve[] {
  const rows = database
    .prepare(
      `SELECT rules_json, previous_rules_json, critic_summary, created_at
       FROM strategy_history ORDER BY id DESC`
    )
    .all() as unknown as EvolveRow[];
  return rows.map((row) => ({
    from: row.previous_rules_json ? JSON.parse(row.previous_rules_json) : undefined,
    to: JSON.parse(row.rules_json),
    criticSummary: row.critic_summary,
    at: fromSqliteTime(row.created_at),
  }));
}

// Times are kept as SQLite's datetime('now') writes them, in UTC, as the table always has.

/** "2026-10-24 22:30:00". */
function toSqliteTime(at: Date): string {
  return at.toISOString().slice(0, 19).replace('T', ' ');
}

function fromSqliteTime(time: string): Date {
  return new Date(`${time.replace(' ', 'T')}Z`);
}
