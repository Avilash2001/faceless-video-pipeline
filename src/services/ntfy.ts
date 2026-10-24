import { request } from 'undici';
import type { Config } from '../loadConfig.js';
import type { Push } from '../types.js';

/** Sends one push to the ntfy topic. It goes as JSON, so any text survives (headers would mangle "₹"). */
export async function sendToNtfy(settings: Config['alerts'], push: Push): Promise<void> {
  const res = await request(`${settings.ntfyServer}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: settings.ntfyTopic, title: push.title, message: push.message }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.body.text();
  if (res.statusCode >= 300) throw new Error(`ntfy answered ${res.statusCode}: ${text.slice(0, 200)}`);
}
