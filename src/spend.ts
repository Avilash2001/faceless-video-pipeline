import type { DatabaseSync } from 'node:sqlite';
import type { Config, ImageProviderName } from './loadConfig.js';
import type { RunOptions } from './types.js';

/** Images a Video is expected to need: Storyboards so far have had 10 or 11 distinct shots, plus a cast sheet. */
const EXPECTED_IMAGES = 12;
/** The story editor's and the storyboard's Gemini calls for one Video, about a cent together so far. */
const TEXT_USD = 0.01;
/** Gemini's price per image at each GEMINI_IMAGE_SIZE; other sizes are priced as 2K. */
const GEMINI_IMAGE_USD: Record<string, number> = { '1K': 0.034, '2K': 0.05, '4K': 0.1 };

/** What one image costs from `provider`, as configured; ComfyUI and stock footage are free. */
export function imagePriceUsd(provider: ImageProviderName, config: Config): number {
  switch (provider) {
    case 'gemini':
      return GEMINI_IMAGE_USD[config.gemini.imageSize] ?? GEMINI_IMAGE_USD['2K'];
    case 'fal':
      return config.fal.imageCostUsd;
    case 'comfyui':
    case 'stock':
      return 0;
  }
}

/** A Video's estimated cost: the image Provider's price times the expected number of images, plus text. */
export interface VideoEstimate {
  usd: number;
  images: number;
  provider: ImageProviderName;
}

/** What a Video made with `options` is expected to cost; a storyboard-only Run makes no images. */
function estimateVideoCost(options: RunOptions, config: Config): VideoEstimate {
  const provider = options.imageProvider ?? config.visuals.imageProvider;
  const images = options.storyboardOnly ? 0 : EXPECTED_IMAGES;
  return { usd: images * imagePriceUsd(provider, config) + TEXT_USD, images, provider };
}

/** Whether a Video made with `options` is expected to fit in what is left of today's Daily budget. */
export interface BudgetCheck {
  estimate: VideoEstimate;
  /** What is left of today's Daily budget; nothing once it is spent. */
  budgetLeftUsd: number;
  fits: boolean;
}

export function checkDailyBudget(options: RunOptions, config: Config, database: DatabaseSync): BudgetCheck {
  const estimate = estimateVideoCost(options, config);
  const budgetLeftUsd = Math.max(0, config.costs.dailyBudgetUsd - spendTodayUsd(database));
  return { estimate, budgetLeftUsd, fits: estimate.usd <= budgetLeftUsd };
}

/** Thrown when paid work would take today's spend past the Daily budget, stopping the Run. */
export class OverBudgetError extends Error {}

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
  return `${formatUsd(usd)} (≈ ₹${inr.toFixed(0)} incl. tax)`;
}

/** "$0.36" */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
