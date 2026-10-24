import fs from 'fs';
import { request } from 'undici';
import { CONFIG } from '../config.js';

/** Submits a job to fal's queue API and waits for the result JSON. */
export async function falRun(model: string, input: Record<string, unknown>, timeoutMs = 10 * 60 * 1000): Promise<any> {
  if (!CONFIG.fal.apiKey) throw new Error('fal provider needs FAL_KEY in .env');
  const headers = { Authorization: `Key ${CONFIG.fal.apiKey}`, 'Content-Type': 'application/json' };

  const submit = await request(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  const job = (await submit.body.json()) as any;
  if (submit.statusCode >= 300 || !job.status_url) {
    throw new Error(`fal ${model} submit failed (${submit.statusCode}): ${JSON.stringify(job).slice(0, 400)}`);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const statusRes = await request(job.status_url, { headers });
    const status = (await statusRes.body.json()) as any;
    if (status.status === 'COMPLETED') {
      const result = await request(job.response_url, { headers });
      const data = (await result.body.json()) as any;
      if (result.statusCode >= 300) throw new Error(`fal ${model} failed: ${JSON.stringify(data).slice(0, 400)}`);
      return data;
    }
    if (status.status && !['IN_QUEUE', 'IN_PROGRESS'].includes(status.status)) {
      throw new Error(`fal ${model} ended with status ${status.status}`);
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error(`fal ${model} timed out after ${timeoutMs / 1000}s`);
}

export function toDataUri(localPath: string): string {
  const mime = /\.jpe?g$/i.test(localPath) ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(localPath).toString('base64')}`;
}

export async function downloadTo(url: string, outPath: string): Promise<string> {
  const res = await request(url);
  if (res.statusCode !== 200) throw new Error(`Download failed (${res.statusCode}): ${url}`);
  fs.writeFileSync(outPath, Buffer.from(await res.body.arrayBuffer()));
  return outPath;
}
