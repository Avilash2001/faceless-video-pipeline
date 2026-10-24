import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { request } from 'undici';
import { CONFIG } from '../config.js';

export interface ComfyInputs {
  prompt: string;
  negative?: string;
  seed: number;
  width: number;
  height: number;
  /** Local image paths, assigned to LoadImage nodes in node-id order. */
  images: string[];
  /** Frame count for video workflows (Wan's "length"). */
  frames?: number;
}

type ComfyGraph = Record<string, { class_type: string; inputs: Record<string, any>; _meta?: { title?: string } }>;

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|gif)$/i;

/**
 * Runs an API-format ComfyUI workflow (File → Export (API)) and returns the first output
 * of the wanted kind. Inputs are injected either through {{PLACEHOLDER}} strings in the JSON
 * (PROMPT, NEGATIVE, SEED, WIDTH, HEIGHT, FRAMES, IMAGE_1..n) or, when there are none, by
 * recognising the usual nodes: the text encoder feeding the sampler's positive input, any
 * seed/noise_seed, width/height, length, and LoadImage nodes.
 */
export async function runComfyWorkflow(
  workflowFile: string,
  inputs: ComfyInputs,
  want: 'image' | 'video'
): Promise<{ data: Buffer; ext: string }> {
  const file = resolveWorkflowPath(workflowFile);
  if (!fs.existsSync(file)) {
    throw new Error(
      `ComfyUI workflow not found: ${file}. Export one with File → Export (API) (see README "Local generation").`
    );
  }

  const uploaded: string[] = [];
  for (const img of inputs.images) uploaded.push(await uploadImage(img));

  const raw = fs.readFileSync(file, 'utf-8');
  const graph: ComfyGraph = raw.includes('{{')
    ? JSON.parse(fillPlaceholders(raw, inputs, uploaded))
    : injectByHeuristics(JSON.parse(raw), inputs, uploaded);

  const submit = await request(`${CONFIG.comfyui.url}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: crypto.randomUUID() }),
  });
  const submitted = (await submit.body.json()) as any;
  if (submit.statusCode !== 200 || !submitted.prompt_id) {
    throw new Error(`ComfyUI rejected the workflow: ${JSON.stringify(submitted).slice(0, 600)}`);
  }

  const history = await waitForHistory(submitted.prompt_id);
  const files: { filename: string; subfolder: string; type: string }[] = [];
  for (const output of Object.values<any>(history.outputs || {})) {
    for (const value of Object.values<any>(output)) {
      if (Array.isArray(value)) files.push(...value.filter((f) => f?.filename));
    }
  }
  const pattern = want === 'image' ? IMAGE_EXT : VIDEO_EXT;
  const match =
    files.find((f) => f.type === 'output' && pattern.test(f.filename)) ||
    files.find((f) => pattern.test(f.filename));
  if (!match) throw new Error(`ComfyUI finished without a ${want} output (got ${files.map((f) => f.filename).join(', ') || 'nothing'}).`);

  const qs = new URLSearchParams({ filename: match.filename, subfolder: match.subfolder || '', type: match.type || 'output' });
  const view = await request(`${CONFIG.comfyui.url}/view?${qs}`);
  if (view.statusCode !== 200) throw new Error(`ComfyUI /view returned ${view.statusCode}`);
  return { data: Buffer.from(await view.body.arrayBuffer()), ext: path.extname(match.filename).toLowerCase() };
}

/** Workflow names are relative to assets/comfy/ unless absolute. */
export function resolveWorkflowPath(workflowFile: string): string {
  return path.resolve(CONFIG.paths.comfyWorkflowsDir, workflowFile);
}

async function uploadImage(localPath: string): Promise<string> {
  const form = new FormData();
  form.append('image', new Blob([fs.readFileSync(localPath)]), path.basename(localPath));
  form.append('overwrite', 'true');
  // Node's built-in fetch/FormData/Blob: mixing undici's FormData with the global Blob breaks multipart.
  const res = await fetch(`${CONFIG.comfyui.url}/upload/image`, { method: 'POST', body: form });
  const data = (await res.json()) as any;
  if (!res.ok || !data.name) throw new Error(`ComfyUI image upload failed: ${JSON.stringify(data)}`);
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}

async function waitForHistory(promptId: string): Promise<any> {
  const deadline = Date.now() + CONFIG.comfyui.timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(`${CONFIG.comfyui.url}/history/${promptId}`);
    const data = (await res.body.json()) as any;
    const entry = data?.[promptId];
    if (entry?.status?.status_str === 'error') {
      const messages = (entry.status.messages || [])
        .filter((m: any) => m[0] === 'execution_error')
        .map((m: any) => m[1]?.exception_message);
      throw new Error(`ComfyUI execution failed: ${messages.join('; ') || 'unknown error'}`);
    }
    if (entry?.status?.completed || (entry?.outputs && Object.keys(entry.outputs).length > 0)) return entry;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`ComfyUI job ${promptId} timed out after ${CONFIG.comfyui.timeoutMs / 1000}s`);
}

function fillPlaceholders(raw: string, inputs: ComfyInputs, uploaded: string[]): string {
  const str = (s: string) => JSON.stringify(s).slice(1, -1);
  let out = raw
    .replace(/"\{\{SEED\}\}"/g, String(inputs.seed))
    .replace(/"\{\{WIDTH\}\}"/g, String(inputs.width))
    .replace(/"\{\{HEIGHT\}\}"/g, String(inputs.height))
    .replace(/"\{\{FRAMES\}\}"/g, String(inputs.frames ?? 81))
    .replace(/\{\{PROMPT\}\}/g, str(inputs.prompt))
    .replace(/\{\{NEGATIVE\}\}/g, str(inputs.negative || ''));
  out = out.replace(/\{\{IMAGE_(\d+)\}\}/g, (_m, n) => str(uploaded[Number(n) - 1] || uploaded[0] || ''));
  return out;
}

function injectByHeuristics(graph: ComfyGraph, inputs: ComfyInputs, uploaded: string[]): ComfyGraph {
  const isLink = (v: unknown): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string';

  // Follow conditioning links back to the node that holds the prompt text.
  const findTextNode = (id: string, seen = new Set<string>()): string | null => {
    if (seen.has(id) || !graph[id]) return null;
    seen.add(id);
    const node = graph[id];
    if (typeof node.inputs.text === 'string' || typeof node.inputs.prompt === 'string') return id;
    for (const v of Object.values(node.inputs)) {
      if (isLink(v)) {
        const found = findTextNode(v[0], seen);
        if (found) return found;
      }
    }
    return null;
  };
  const setText = (id: string | null, text: string) => {
    if (!id) return;
    const node = graph[id];
    if (typeof node.inputs.text === 'string') node.inputs.text = text;
    else node.inputs.prompt = text;
  };

  let positiveId: string | null = null;
  let negativeId: string | null = null;
  for (const node of Object.values(graph)) {
    const pos = node.inputs.positive ?? node.inputs.conditioning;
    if (!positiveId && isLink(pos)) positiveId = findTextNode(pos[0]);
    if (!negativeId && isLink(node.inputs.negative)) negativeId = findTextNode(node.inputs.negative[0]);
  }
  positiveId ??=
    Object.keys(graph).find((id) => /positive/i.test(graph[id]._meta?.title || '') && findTextNode(id) === id) ||
    Object.keys(graph).find((id) => /TextEncode/i.test(graph[id].class_type)) ||
    null;
  if (!positiveId) throw new Error('Could not find the prompt node in the ComfyUI workflow; add a {{PROMPT}} placeholder.');
  setText(positiveId, inputs.prompt);
  if (negativeId && negativeId !== positiveId && inputs.negative) setText(negativeId, inputs.negative);

  const loadImageIds = Object.keys(graph)
    .filter((id) => graph[id].class_type === 'LoadImage')
    .sort((a, b) => Number(a) - Number(b));
  loadImageIds.forEach((id, i) => {
    if (uploaded.length > 0) graph[id].inputs.image = uploaded[i] ?? uploaded[0];
  });

  for (const node of Object.values(graph)) {
    for (const key of ['seed', 'noise_seed']) {
      if (typeof node.inputs[key] === 'number') node.inputs[key] = inputs.seed;
    }
    if (typeof node.inputs.width === 'number' && typeof node.inputs.height === 'number') {
      node.inputs.width = inputs.width;
      node.inputs.height = inputs.height;
    }
    if (inputs.frames && typeof node.inputs.length === 'number') node.inputs.length = inputs.frames;
  }
  return graph;
}
