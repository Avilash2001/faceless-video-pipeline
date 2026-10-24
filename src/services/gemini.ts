import { GoogleGenAI, ThinkingConfig, ThinkingLevel } from '@google/genai';
import { CONFIG } from '../config.js';
import { recordSpend, textCallCostUsd } from './costs.js';

// Gemini returns transient 503 "high demand" errors; the SDK's built-in backoff retries them (2s, 4s, 8s, 16s).
export const ai = new GoogleGenAI({
  apiKey: CONFIG.gemini.apiKey,
  httpOptions: { retryOptions: { attempts: 5, initialDelay: 2 } },
});

// Only models the API still serves (2.0/2.5 Flash now return 404 for this key).
const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'];

/** Thinking tokens bill as output, so keep them low; 3.x models take a level, 2.5 a token budget. */
function thinkingConfigFor(model: string): ThinkingConfig | undefined {
  const level = CONFIG.gemini.thinking as ThinkingLevel;
  if (/^gemini-3/.test(model)) return { thinkingLevel: level };
  if (/^gemini-2\.5/.test(model)) {
    const budgets: Record<string, number> = { MINIMAL: 0, LOW: 1024, MEDIUM: 4096 };
    return { thinkingBudget: budgets[level] ?? -1 };
  }
  return undefined;
}

/**
 * Calls Gemini for a JSON response with automatic model fallback in case a configured
 * model ID is unavailable or rate-limited on the user's API tier. Logs each call's cost.
 */
export async function generateContentWithFallback(params: {
  contents: string;
  systemInstruction?: string;
  responseSchema: any;
  /** Preferred model; defaults to GEMINI_MODEL. */
  model?: string;
  /** Short name for the spend log, e.g. "storyboard". */
  label?: string;
}) {
  const chain = Array.from(new Set([params.model || CONFIG.gemini.model, ...FALLBACK_MODELS].filter(Boolean)));
  let lastErr: unknown;
  for (const modelName of chain) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: params.contents,
        config: {
          systemInstruction: params.systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: params.responseSchema,
          thinkingConfig: thinkingConfigFor(modelName),
        },
      });
      if (modelName !== chain[0]) {
        console.log(`[Gemini] Succeeded using fallback model: ${modelName}`);
      }
      recordSpend(`text:${params.label || 'call'}:${modelName}`, textCallCostUsd(modelName, response.usageMetadata));
      return response;
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message || err);
      // A project-wide spending cap fails every model the same way; stop instead of cycling.
      if (/spending cap/i.test(msg)) {
        throw new Error(
          'Gemini project spending cap reached. Raise it in Google AI Studio (Settings → Billing / spend cap) ' +
            'or wait for the monthly reset. DAILY_BUDGET_USD keeps the pipeline itself within budget.'
        );
      }
      console.warn(`[Gemini] Model "${modelName}" failed (${msg.slice(0, 120)}). Trying next fallback...`);
    }
  }
  throw lastErr;
}
