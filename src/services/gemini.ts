import { GoogleGenAI } from '@google/genai';
import { CONFIG } from '../config.js';

// Gemini returns transient 503 "high demand" errors; the SDK's built-in backoff retries them (2s, 4s, 8s, 16s).
export const ai = new GoogleGenAI({
  apiKey: CONFIG.gemini.apiKey,
  httpOptions: { retryOptions: { attempts: 5, initialDelay: 2 } },
});

const MODEL_FALLBACK_CHAIN = Array.from(
  new Set(
    [CONFIG.gemini.model, 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.0-flash'].filter(Boolean)
  )
);

/**
 * Calls Gemini for a JSON response with automatic model fallback in case a configured
 * model ID is unavailable or rate-limited on the user's API tier.
 */
export async function generateContentWithFallback(params: {
  contents: string;
  systemInstruction?: string;
  responseSchema: any;
}) {
  let lastErr: unknown;
  for (const modelName of MODEL_FALLBACK_CHAIN) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: params.contents,
        config: {
          systemInstruction: params.systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: params.responseSchema,
        },
      });
      if (modelName !== CONFIG.gemini.model) {
        console.log(`[Gemini] Succeeded using fallback model: ${modelName}`);
      }
      return response;
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message || err);
      console.warn(`[Gemini] Model "${modelName}" failed (${msg.slice(0, 120)}). Trying next fallback...`);
    }
  }
  throw lastErr;
}
