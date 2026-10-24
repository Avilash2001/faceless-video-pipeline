import { request } from 'undici';
import { isSourceAlreadyProcessed } from '../db/index.js';
import { GENRES } from '../genres.js';
import { NicheCategory, StoryCandidate } from '../types.js';
import { pickRandom, shuffle } from './util.js';

const API = 'https://en.wikipedia.org/w/api.php';
// Wikimedia asks for a descriptive User-Agent with a way to reach the operator.
const USER_AGENT = 'faceless-video-pipeline/2.0 (https://github.com/Avilash2001/faceless-video-pipeline)';

async function wikiQuery(params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  const res = await request(`${API}?${qs}`, {
    headers: { 'User-Agent': USER_AGENT },
    headersTimeout: 10_000,
  });
  if (res.statusCode !== 200) {
    await res.body.dump();
    throw new Error(`Wikipedia API returned ${res.statusCode}`);
  }
  return res.body.json();
}

/**
 * Documented true-story leads: random members of the genre's categories, ranked by the
 * last 30 days of pageviews (what people are currently curious about), with full plain text
 * for the top few. Text is only used as a fact source; scripts never copy it.
 */
export async function fetchWikipediaCandidates(niche: NicheCategory): Promise<StoryCandidate[]> {
  const category = pickRandom(GENRES[niche].wikipediaCategories || []);
  const members = await wikiQuery({
    action: 'query',
    list: 'categorymembers',
    cmtitle: `Category:${category}`,
    cmtype: 'page',
    cmnamespace: '0',
    cmlimit: '200',
  });

  const pages = shuffle(
    ((members?.query?.categorymembers || []) as { pageid: number; title: string }[]).filter(
      (p) => !/^List of/i.test(p.title) && !isSourceAlreadyProcessed(`wiki_${p.pageid}`)
    )
  ).slice(0, 40);
  if (pages.length === 0) return [];

  const views = await wikiQuery({
    action: 'query',
    prop: 'pageviews',
    pvipdays: '30',
    pageids: pages.map((p) => p.pageid).join('|'),
  });
  const ranked = ((views?.query?.pages || []) as any[])
    .map((p) => ({
      pageid: p.pageid as number,
      title: p.title as string,
      views: Object.values(p.pageviews || {}).reduce<number>((acc, v) => acc + (Number(v) || 0), 0),
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 6);

  const out: StoryCandidate[] = [];
  for (const page of ranked) {
    const extract = await wikiQuery({
      action: 'query',
      prop: 'extracts',
      explaintext: '1',
      exsectionformat: 'plain',
      pageids: String(page.pageid),
    });
    const text: string = extract?.query?.pages?.[0]?.extract || '';
    // Skip stubs; a story needs enough documented detail to have an arc.
    if (text.length < 2500) continue;

    out.push({
      externalId: `wiki_${page.pageid}`,
      niche,
      source: 'wikipedia',
      title: page.title,
      bodyText: trimReferenceSections(text).slice(0, 9000),
      topComments: [],
      sourceUrl: `https://en.wikipedia.org/?curid=${page.pageid}`,
      sourceLabel: `Wikipedia: ${page.title}`,
      popularity: page.views,
      ageHours: 24,
    });
  }
  return out;
}

function trimReferenceSections(text: string): string {
  const cut = text.search(/\n(See also|References|Notes|Further reading|External links)\n/);
  return (cut > 0 ? text.slice(0, cut) : text).trim();
}
