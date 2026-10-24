import { CONFIG } from '../config.js';
import { db } from '../db/index.js';
import { currentRun } from '../runContext.js';
import { formatCost as formatCostWith, insertSpend, spendTodayUsd } from '../spend.js';

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

/** Logs paid work; spend made during a Run is recorded against that Run. */
export function recordSpend(item: string, usd: number): void {
  if (!(usd > 0)) return;
  const run = currentRun();
  if (run) run.spend(item, usd);
  else insertSpend(db, item, usd);
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
  return spendTodayUsd(db);
}

/** True when spending `usd` more today stays within DAILY_BUDGET_USD. */
export function withinBudget(usd: number): boolean {
  return todaysSpendUsd() + usd <= CONFIG.costs.dailyBudgetUsd;
}

/** "$0.36 (≈ ₹37 incl. tax)" */
export function formatCost(usd: number): string {
  return formatCostWith(usd, CONFIG.costs);
}
