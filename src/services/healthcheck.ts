import { request } from 'undici';

/** Tells healthchecks.io the daemon is alive; it pushes once these pings stop. */
export async function pingHealthcheck(url: string): Promise<void> {
  const res = await request(url, { signal: AbortSignal.timeout(10_000) });
  await res.body.dump();
  if (res.statusCode >= 300) throw new Error(`Heartbeat ping answered ${res.statusCode}`);
}
