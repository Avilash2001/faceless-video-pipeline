import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { request } from 'undici';
import { CONFIG } from '../config.js';
import { isSourceAlreadyProcessed } from '../db/index.js';
import { GENRES } from '../genres.js';
import { NicheCategory, StoryCandidate } from '../types.js';
import { decodeHtmlEntities, htmlToText, pickRandom, shuffle } from './util.js';

/**
 * Reddit story leads. Three access modes (REDDIT_ACCESS):
 * - api:   official Data API with an approved app (client_credentials). Reddit requires
 *          pre-approval since Nov 2025, and monetized use needs a commercial agreement.
 * - inbox: stories you have permission to use, dropped into data/story_inbox/.
 * - rss:   public top-of-week Atom feeds. Full post text, ~1 request per 20-60 s, and
 *          Reddit's User Agreement prohibits automated scraping without consent — opt-in only.
 */
export async function fetchRedditCandidates(niche: NicheCategory): Promise<StoryCandidate[]> {
  const subreddits = GENRES[niche].subreddits || [];
  switch (CONFIG.reddit.access) {
    case 'api':
      return fetchViaApi(niche, subreddits);
    case 'rss':
      return fetchViaRss(niche, pickRandom(subreddits));
    case 'inbox':
    default:
      return readInbox(niche);
  }
}

const MIN_BODY_CHARS = 900;
const MAX_BODY_CHARS = 9000;

function userAgent(): string {
  return CONFIG.reddit.userAgent;
}

// ---------- api ----------

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAppToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  if (!CONFIG.reddit.clientId || !CONFIG.reddit.clientSecret) {
    throw new Error('REDDIT_ACCESS=api needs REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET (an approved Reddit app).');
  }
  const basic = Buffer.from(`${CONFIG.reddit.clientId}:${CONFIG.reddit.clientSecret}`).toString('base64');
  const res = await request('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent(),
    },
    body: 'grant_type=client_credentials',
  });
  const data = (await res.body.json()) as any;
  if (res.statusCode !== 200 || !data.access_token) {
    throw new Error(`Reddit token request failed (${res.statusCode}): ${JSON.stringify(data).slice(0, 200)}`);
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

async function oauthGet(pathAndQuery: string): Promise<any> {
  const token = await getAppToken();
  const res = await request(`https://oauth.reddit.com${pathAndQuery}`, {
    headers: { Authorization: `bearer ${token}`, 'User-Agent': userAgent() },
    headersTimeout: 10_000,
  });
  if (res.statusCode !== 200) {
    await res.body.dump();
    throw new Error(`Reddit API ${pathAndQuery} returned ${res.statusCode}`);
  }
  return res.body.json();
}

async function fetchViaApi(niche: NicheCategory, subreddits: string[]): Promise<StoryCandidate[]> {
  const out: StoryCandidate[] = [];
  const nowSec = Date.now() / 1000;
  for (const sub of subreddits) {
    try {
      const data = await oauthGet(`/r/${sub}/top?t=week&limit=25&raw_json=1`);
      for (const item of data?.data?.children || []) {
        const post = item.data;
        if (!post || post.stickied || post.over_18) continue;
        const body = (post.selftext || '').trim();
        if (body.length < MIN_BODY_CHARS || body.length > MAX_BODY_CHARS) continue;
        const externalId = `reddit_${post.id}`;
        if (isSourceAlreadyProcessed(externalId)) continue;
        out.push({
          externalId,
          niche,
          source: 'reddit',
          title: post.title,
          bodyText: body,
          topComments: [],
          sourceUrl: `https://www.reddit.com${post.permalink}`,
          sourceLabel: `a story shared on r/${sub}`,
          popularity: post.ups || 0,
          ageHours: Math.max(1, (nowSec - post.created_utc) / 3600),
        });
      }
    } catch (err) {
      console.warn(`[Reddit] r/${sub} failed:`, (err as Error).message);
    }
  }
  out.sort((a, b) => b.popularity - a.popularity);
  const top = out.slice(0, 8);
  for (const c of top.slice(0, 4)) {
    c.topComments = await fetchApiTopComments(c.externalId.replace(/^reddit_/, ''));
  }
  return top;
}

async function fetchApiTopComments(postId: string): Promise<string[]> {
  try {
    const payload = await oauthGet(`/comments/${postId}?sort=top&limit=6&depth=1&raw_json=1`);
    return (payload?.[1]?.data?.children || [])
      .map((c: any) => c?.data?.body)
      .filter((b: any) => typeof b === 'string' && b.length > 30 && b.length < 600)
      .slice(0, 3);
  } catch {
    return [];
  }
}

// ---------- rss ----------

async function fetchViaRss(niche: NicheCategory, sub: string): Promise<StoryCandidate[]> {
  const res = await request(`https://www.reddit.com/r/${sub}/top/.rss?t=week&limit=25`, {
    headers: { 'User-Agent': userAgent() },
    headersTimeout: 10_000,
  });
  if (res.statusCode !== 200) {
    await res.body.dump();
    console.warn(
      `[Reddit] RSS r/${sub} returned ${res.statusCode}${
        res.statusCode === 429 ? ' (rate limited; Reddit allows roughly 1 feed request per minute)' : ''
      }.`
    );
    return [];
  }
  const xml = await res.body.text();
  if (!xml.includes('<feed')) {
    console.warn(`[Reddit] RSS r/${sub} returned a non-feed page (likely a block or rate-limit page).`);
    return [];
  }
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  const out: StoryCandidate[] = [];

  entries.forEach((entry, rank) => {
    const id = /<id>t3_([a-z0-9]+)<\/id>/.exec(entry)?.[1];
    const title = /<title>([\s\S]*?)<\/title>/.exec(entry)?.[1];
    const link = /<link href="([^"]+)"/.exec(entry)?.[1];
    const html = /<content type="html">([\s\S]*?)<\/content>/.exec(entry)?.[1];
    const published = /<published>([^<]+)<\/published>/.exec(entry)?.[1];
    if (!id || !title || !html) return;

    // The feed HTML-escapes the post HTML, and appends a "submitted by ... [link] [comments]" footer.
    const body = htmlToText(decodeHtmlEntities(html)).replace(/\s*submitted by[\s\S]*$/i, '').trim();
    if (body.length < MIN_BODY_CHARS || body.length > MAX_BODY_CHARS) return;
    const externalId = `reddit_${id}`;
    if (isSourceAlreadyProcessed(externalId)) return;

    out.push({
      externalId,
      niche,
      source: 'reddit',
      title: decodeHtmlEntities(title),
      bodyText: body,
      topComments: [],
      sourceUrl: link || `https://www.reddit.com/comments/${id}`,
      sourceLabel: `a story shared on r/${sub}`,
      // The feed has no vote counts but is ordered by top score.
      popularity: entries.length - rank,
      ageHours: published ? Math.max(1, (Date.now() - Date.parse(published)) / 3_600_000) : 72,
    });
  });

  console.log(`[Reddit] RSS r/${sub}: ${entries.length} posts, ${out.length} usable (length and not yet used).`);
  return out.slice(0, 8);
}

// ---------- inbox ----------

/**
 * data/story_inbox/ accepts .txt/.md (first line = title, rest = body) or .json
 * ({ title, body, sourceUrl?, credit?, niche? }). Use it for stories you have permission to adapt.
 */
function readInbox(niche: NicheCategory): StoryCandidate[] {
  const dir = CONFIG.paths.storyInboxDir;
  if (!fs.existsSync(dir)) return [];
  const out: StoryCandidate[] = [];

  for (const file of shuffle(fs.readdirSync(dir))) {
    const full = path.join(dir, file);
    const ext = path.extname(file).toLowerCase();
    if (!['.txt', '.md', '.json'].includes(ext)) continue;

    const raw = fs.readFileSync(full, 'utf-8');
    const externalId = `inbox_${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12)}`;
    if (isSourceAlreadyProcessed(externalId)) continue;

    let entry: { title: string; body: string; sourceUrl?: string; credit?: string; niche?: string };
    if (ext === '.json') {
      entry = JSON.parse(raw);
    } else {
      const [firstLine, ...rest] = raw.split(/\r?\n/);
      entry = { title: firstLine.replace(/^#\s*/, '').trim(), body: rest.join('\n').trim() };
    }
    if (entry.niche && entry.niche !== niche) continue;
    if (!entry.body || entry.body.length < 200) continue;

    out.push({
      externalId,
      niche,
      source: 'reddit',
      title: entry.title,
      bodyText: entry.body.slice(0, MAX_BODY_CHARS),
      topComments: [],
      sourceUrl: entry.sourceUrl || null,
      sourceLabel: entry.credit || 'a story shared with permission',
      popularity: 1,
      ageHours: 24,
    });
    if (out.length >= 8) break;
  }
  return out;
}
