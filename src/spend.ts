import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './loadConfig.js';

/** Adds an entry to the spend log, against a Run when it was spent during one. */
export function insertSpend(database: DatabaseSync, item: string, usd: number, runId?: string): void {
  database.prepare('INSERT INTO spend_log (item, usd, run_id) VALUES (?, ?, ?)').run(item, usd, runId ?? null);
}

/** Spend on today's UTC day, which is what the Daily budget limits. */
export function spendTodayUsd(database: DatabaseSync): number {
  const row = database
    .prepare("SELECT COALESCE(SUM(usd), 0) AS total FROM spend_log WHERE date(created_at) = date('now')")
    .get() as { total: number };
  return row.total;
}

/** Spend recorded against one Run. */
export function spendForRunUsd(database: DatabaseSync, runId: string): number {
  const row = database
    .prepare('SELECT COALESCE(SUM(usd), 0) AS total FROM spend_log WHERE run_id = ?')
    .get(runId) as { total: number };
  return row.total;
}

/** "$0.36 (≈ ₹37 incl. tax)" */
export function formatCost(usd: number, costs: Config['costs']): string {
  const inr = usd * costs.usdToInr * costs.taxMultiplier;
  return `$${usd.toFixed(2)} (≈ ₹${inr.toFixed(0)} incl. tax)`;
}
