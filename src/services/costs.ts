import { CONFIG } from '../config.js';
import { db } from '../db/index.js';

/** USD per 1M tokens (paid tier, Oct 2026; thinking tokens bill as output). Unknown models count as $0. */
const TEXT_PRICES: Record<string, { input: number; output: number }> = {
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  // Aliases: priced as the models they currently point to (estimate).
  'gemini-flash-latest': { input: 0.75, output: 3.75 },
  'gemini-flash-lite-latest': { input: 0.25, output: 1.5 },
};

let runSpendUsd = 0;

export function recordSpend(item: string, usd: number): void {
  if (!(usd > 0)) return;
  runSpendUsd += usd;
  db.prepare('INSERT INTO spend_log (item, usd) VALUES (?, ?)').run(item, usd);
}

export function textCallCostUsd(
  model: string,
  usage: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined
): number {
  const price = TEXT_PRICES[model];
  if (!price || !usage) return 0;
  const output = (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0);
  return ((usage.promptTokenCount || 0) * price.input + output * price.output) / 1_000_000;
}

export function todaysSpendUsd(): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(usd), 0) AS total FROM spend_log WHERE date(created_at) = date('now')")
    .get() as { total: number };
  return row.total;
}

/** True when spending `usd` more today stays within DAILY_BUDGET_USD. */
export function withinBudget(usd: number): boolean {
  return todaysSpendUsd() + usd <= CONFIG.costs.dailyBudgetUsd;
}

export function currentRunSpendUsd(): number {
  return runSpendUsd;
}

/** "$0.36 (≈ ₹37 incl. tax)" */
export function formatCost(usd: number): string {
  const inr = usd * CONFIG.costs.usdToInr * CONFIG.costs.taxMultiplier;
  return `$${usd.toFixed(2)} (≈ ₹${inr.toFixed(0)} incl. tax)`;
}
