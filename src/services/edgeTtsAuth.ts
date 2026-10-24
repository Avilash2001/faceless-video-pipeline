import { createHash, randomUUID } from 'crypto';
import { MsEdgeTTS } from 'msedge-tts';

/**
 * Since October 2026 the Edge Read Aloud WebSocket only accepts v2 Sec-MS-GEC tokens.
 * msedge-tts@2.1.0 still sends v1 tokens, and its fallback host (api.msedgeservices.com)
 * answers the handshake with a bare HTTP 200, so every synthesis fails.
 *
 * This is a port of the v2 token from the Python edge-tts project (rany2/edge-tts#492):
 * "<CS64 hex>-<SHA-256 hex>" over a fixed salt + Windows file-time ticks + client token.
 * Delete this module once msedge-tts ships v2 support upstream.
 */

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const SEC_MS_GEC_VERSION = '2-143.0.3650.96';
const TOKEN_SALT = 'Copyright (C) Microsoft Corporation. All rights reserved.';
const WIN_EPOCH_SECONDS = 11644473600;

const mul = (a: number, b: number) => Math.imul(a, b) >>> 0;
const rol16 = (v: number) => ((v << 16) | (v >>> 16)) >>> 0;

function cs64Hex(message: Buffer, sha: Buffer): string {
  const keyA = (sha.readUInt32LE(0) | 1) >>> 0;
  const keyB = (sha.readUInt32LE(4) | 1) >>> 0;

  const padded = Buffer.concat([message, Buffer.alloc((4 - (message.length % 4)) % 4)]);
  const words: number[] = [];
  for (let i = 0; i < padded.length; i += 4) words.push(padded.readUInt32LE(i));
  if (words.length % 2) words.push(0);

  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;
  for (let i = 0; i < words.length; i += 2) {
    const x = mul(words[i], keyA);
    const y = mul(words[i + 1], keyB);

    let q = mul(rol16(mul(rol16(words[i]), 0xef0569fb) + x), 0x76f50f34);
    swapAcc = (swapAcc + mul(rol16(q), 0xc3efea97) + q) >>> 0;
    q = mul(rol16(mul(rol16(words[i + 1]), 0xc31713db) + y), 0x1881ce3c);
    swapLast = (mul(rol16(q), 0x35bd1ec9) + q) >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;

    state = (mul(state, keyA) + x) >>> 0;
    state = mul(rol16(state), 0xcf98b111);
    state = mul(rol16(state), 0x87085b9f);
    state = mul(rol16(state), 0x12ceb96d);
    state = mul(rol16(state), 0x257e1d83);
    acc = (acc + state) >>> 0;

    let t = (mul(state, keyB) + y) >>> 0;
    t = mul(rol16(t), 0xa27416f5);
    t = mul(rol16(t), 0xd38396ff);
    state = mul(rol16(mul(rol16(t), 0x7c932b89)), 0xbfa49f69);
    acc = (acc + state) >>> 0;
  }

  const out = Buffer.alloc(8);
  out.writeUInt32LE((swapLast ^ state) >>> 0, 0);
  out.writeUInt32LE((swapAcc ^ acc) >>> 0, 4);
  return out.toString('hex').toUpperCase();
}

export function generateSecMsGecV2(unixSeconds: number): string {
  const windowsSeconds = unixSeconds + WIN_EPOCH_SECONDS;
  const ticks = (windowsSeconds - (windowsSeconds % 300)) * 1e7;
  const message = Buffer.from(`${TOKEN_SALT}${ticks}${TRUSTED_CLIENT_TOKEN}`, 'ascii');
  const sha = createHash('sha256').update(message).digest();
  return `${cs64Hex(message, sha)}-${sha.toString('hex').toUpperCase()}`;
}

/**
 * Points msedge-tts back at the Read Aloud host with a v2 token. Reuses the library's
 * own clock offset, so its 403 → resync-clock → retry path keeps working.
 */
export function useEdgeTtsV2Auth(): void {
  const lib = MsEdgeTTS as unknown as {
    getSynthUrl: () => Promise<string>;
    _clockOffsetMs?: number;
  };
  lib.getSynthUrl = async () => {
    const token = generateSecMsGecV2((Date.now() + (lib._clockOffsetMs ?? 0)) / 1000);
    const connectionId = randomUUID().replaceAll('-', '');
    return `${WSS_URL}&ConnectionId=${connectionId}&Sec-MS-GEC=${token}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
  };
}
