import { request } from 'undici';
import { isSourceAlreadyProcessed } from '../db/index.js';
import { NicheCategory, RawTrendCandidate, StrategyRules } from '../types.js';

interface SubredditSource {
  niche: NicheCategory;
  subreddit: string;
}

const SUBREDDIT_MAP: SubredditSource[] = [
  { niche: 'tech_ai_postmortems', subreddit: 'programming' },
  { niche: 'tech_ai_postmortems', subreddit: 'sysadmin' },
  { niche: 'workplace_legal_drama', subreddit: 'MaliciousCompliance' },
  { niche: 'workplace_legal_drama', subreddit: 'talesfromtechsupport' },
  { niche: 'finance_money_psychology', subreddit: 'personalfinance' },
  { niche: 'finance_money_psychology', subreddit: 'FluentInFinance' },
  { niche: 'cybersecurity_scam_breakdowns', subreddit: 'Scams' },
  { niche: 'cybersecurity_scam_breakdowns', subreddit: 'cybersecurity' },
  { niche: 'weird_history_mysteries', subreddit: 'UnresolvedMysteries' },
  { niche: 'weird_history_mysteries', subreddit: 'todayilearned' },
];

const HN_NICHE_QUERIES: Record<NicheCategory, string> = {
  tech_ai_postmortems: 'outage OR postmortem OR production OR bug OR database OR AI',
  workplace_legal_drama: 'fired OR company OR manager OR lawsuit OR workplace OR CEO',
  finance_money_psychology: 'money OR salary OR market OR bank OR debt OR startup',
  cybersecurity_scam_breakdowns: 'hacked OR breach OR scam OR phishing OR vulnerability OR leak',
  weird_history_mysteries: 'history OR mystery OR discovered OR ancient OR phenomenon',
};

/**
 * Selects a target niche using epsilon-greedy weighted sampling from strategy_rules.json,
 * then fetches rising/hot candidates across multiple open sources (Reddit JSON,
 * Hacker News Algolia Niche Search + Comments, Lemmy Public API, and Dev.to)
 * so ISP blocks on Reddit never break discovery.
 */
export async function findBestTrendingTopic(
  strategy: StrategyRules
): Promise<RawTrendCandidate> {
  const targetNiche = pickWeightedKey(strategy.nicheWeights, strategy.explorationRate);
  const allNiches: NicheCategory[] = [
    targetNiche,
    ...((Object.keys(strategy.nicheWeights) as NicheCategory[]).filter(
      (n) => n !== targetNiche
    )),
  ];

  for (const niche of allNiches) {
    const weight = strategy.nicheWeights[niche] || 0.2;
    const candidates: RawTrendCandidate[] = [];

    const tasks = await Promise.allSettled([
      fetchRedditNicheCandidates(niche, weight),
      fetchHackerNewsNicheCandidates(niche, weight),
      fetchLemmyNicheCandidates(niche, weight),
      niche === 'tech_ai_postmortems' ? fetchDevToCandidates(weight) : Promise.resolve([]),
    ]);

    for (const t of tasks) {
      if (t.status === 'fulfilled' && Array.isArray(t.value)) {
        candidates.push(...t.value);
      }
    }

    const freshCandidates = candidates
      .filter((c) => !isSourceAlreadyProcessed(c.externalId))
      .sort((a, b) => b.velocityScore - a.velocityScore);

    if (freshCandidates.length > 0) {
      const winner = freshCandidates[0];
      if (winner.sourcePlatform === 'reddit' && winner.topComments.length === 0) {
        winner.topComments = await fetchRedditTopComments(winner.sourceUrl);
      } else if (
        winner.sourcePlatform === 'hackernews' &&
        winner.topComments.length === 0
      ) {
        const hnId = winner.externalId.replace(/^hn_/, '');
        winner.topComments = await fetchHackerNewsTopComments(hnId);
      }
      return winner;
    }
  }

  throw new Error('All trend sources exhausted across all niches.');
}

async function fetchRedditNicheCandidates(
  niche: NicheCategory,
  nicheWeight: number
): Promise<RawTrendCandidate[]> {
  const matchingSubs = SUBREDDIT_MAP.filter((s) => s.niche === niche);
  const out: RawTrendCandidate[] = [];

  for (const source of matchingSubs) {
    try {
      const url = `https://old.reddit.com/r/${source.subreddit}/hot.json?limit=15&raw_json=1`;
      const res = await request(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
        headersTimeout: 6000,
      });

      if (res.statusCode !== 200) continue;
      const data = (await res.body.json()) as any;
      const posts = data?.data?.children || [];
      const nowSec = Date.now() / 1000;

      for (const item of posts) {
        const post = item.data;
        if (!post || post.stickied || post.over_18) continue;

        const bodyText = (post.selftext || '').trim();
        if (bodyText.length < 160 && source.subreddit !== 'todayilearned') continue;

        const ageHours = Math.max(1, (nowSec - post.created_utc) / 3600);
        const upvotes = Math.max(1, post.ups || 1);
        const commentCount = Math.max(1, post.num_comments || 1);
        const discussionMultiplier = 1 + Math.min(2.5, commentCount / upvotes);
        const velocityScore =
          (upvotes / Math.pow(ageHours + 2, 1.35)) *
          discussionMultiplier *
          (0.5 + nicheWeight);

        out.push({
          externalId: `reddit_${post.id}`,
          niche,
          sourcePlatform: 'reddit',
          title: post.title,
          bodyText: (bodyText || post.title).slice(0, 3500),
          topComments: [],
          sourceUrl: `https://old.reddit.com${post.permalink}`,
          upvotes,
          commentCount,
          ageHours,
          velocityScore,
        });
      }
    } catch {
      // Ignore individual subreddit timeouts or ISP blocks
    }
  }

  return out;
}

async function fetchRedditTopComments(permalinkUrl: string): Promise<string[]> {
  try {
    const jsonUrl = `${permalinkUrl.replace(/\/$/, '')}.json?limit=6&sort=top&raw_json=1`;
    const res = await request(jsonUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
      },
      headersTimeout: 5000,
    });
    if (res.statusCode !== 200) return [];
    const payload = (await res.body.json()) as any[];
    const commentNodes = payload?.[1]?.data?.children || [];
    return commentNodes
      .map((c: any) => c?.data?.body)
      .filter((b: any) => typeof b === 'string' && b.length > 30 && b.length < 600)
      .slice(0, 3);
  } catch {
    return [];
  }
}

async function fetchHackerNewsNicheCandidates(
  niche: NicheCategory,
  nicheWeight: number
): Promise<RawTrendCandidate[]> {
  try {
    const minTimestamp = Math.floor(Date.now() / 1000) - 14 * 24 * 3600;
    const query = encodeURIComponent(HN_NICHE_QUERIES[niche]);
    const url = `https://hn.algolia.com/api/v1/search?query=${query}&tags=story&numericFilters=created_at_i>${minTimestamp},points>25&hitsPerPage=20`;
    const res = await request(url, { headersTimeout: 6000 });
    if (res.statusCode !== 200) return [];

    const data = (await res.body.json()) as any;
    const hits = data?.hits || [];
    const nowSec = Date.now() / 1000;

    return hits.map((hit: any) => {
      const ageHours = Math.max(1, (nowSec - hit.created_at_i) / 3600);
      const upvotes = hit.points || 40;
      const commentCount = hit.num_comments || 15;
      const velocityScore =
        (upvotes / Math.pow(ageHours + 2, 1.25)) *
        (1 + Math.min(2.5, commentCount / upvotes)) *
        (0.5 + nicheWeight);

      return {
        externalId: `hn_${hit.objectID}`,
        niche,
        sourcePlatform: 'hackernews' as const,
        title: hit.title,
        bodyText:
          hit.story_text ||
          `Trending ${niche.replace(/_/g, ' ')} story: "${hit.title}" (${
            hit.url || ''
          }) with ${upvotes} upvotes and ${commentCount} community comments.`,
        topComments: [],
        sourceUrl:
          hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        upvotes,
        commentCount,
        ageHours,
        velocityScore,
      };
    });
  } catch {
    return [];
  }
}

async function fetchHackerNewsTopComments(objectId: string): Promise<string[]> {
  try {
    const url = `https://hn.algolia.com/api/v1/items/${objectId}`;
    const res = await request(url, { headersTimeout: 5000 });
    if (res.statusCode !== 200) return [];
    const data = (await res.body.json()) as any;
    const children = data?.children || [];
    return children
      .map((c: any) =>
        typeof c?.text === 'string'
          ? c.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
          : ''
      )
      .filter((t: string) => t.length > 40)
      .slice(0, 3)
      .map((t: string) => t.slice(0, 500));
  } catch {
    return [];
  }
}

async function fetchLemmyNicheCandidates(
  niche: NicheCategory,
  nicheWeight: number
): Promise<RawTrendCandidate[]> {
  try {
    const url = `https://lemmy.world/api/v3/post/list?sort=TopDay&limit=20`;
    const res = await request(url, { headersTimeout: 6000 });
    if (res.statusCode !== 200) return [];
    const data = (await res.body.json()) as any;
    const posts = data?.posts || [];
    const nowSec = Date.now() / 1000;

    return posts
      .filter((p: any) => p?.post?.name && !p?.post?.nsfw)
      .map((p: any) => {
        const publishedSec = new Date(p.post.published).getTime() / 1000;
        const ageHours = Math.max(1, (nowSec - publishedSec) / 3600);
        const upvotes = Math.max(5, p.counts?.upvotes || 10);
        const commentCount = Math.max(1, p.counts?.comments || 5);
        const velocityScore =
          (upvotes / Math.pow(ageHours + 2, 1.3)) *
          (1 + Math.min(2, commentCount / upvotes)) *
          (0.5 + nicheWeight);

        return {
          externalId: `lemmy_${p.post.id}`,
          niche,
          sourcePlatform: 'rss' as const,
          title: p.post.name,
          bodyText: (p.post.body || p.post.name).slice(0, 3000),
          topComments: [],
          sourceUrl: p.post.ap_id || `https://lemmy.world/post/${p.post.id}`,
          upvotes,
          commentCount,
          ageHours,
          velocityScore,
        };
      });
  } catch {
    return [];
  }
}

async function fetchDevToCandidates(
  nicheWeight: number
): Promise<RawTrendCandidate[]> {
  try {
    const url = `https://dev.to/api/articles?top=2&per_page=15`;
    const res = await request(url, { headersTimeout: 6000 });
    if (res.statusCode !== 200) return [];
    const articles = (await res.body.json()) as any[];
    return (articles || []).map((a: any) => ({
      externalId: `devto_${a.id}`,
      niche: 'tech_ai_postmortems' as NicheCategory,
      sourcePlatform: 'rss' as const,
      title: a.title,
      bodyText: `${a.title}. ${a.description || ''} (Tags: ${a.tag_list?.join(', ') || ''})`,
      topComments: [],
      sourceUrl: a.url,
      upvotes: a.public_reactions_count || 30,
      commentCount: a.comments_count || 5,
      ageHours: 12,
      velocityScore: ((a.public_reactions_count || 30) / 8) * (0.5 + nicheWeight),
    }));
  } catch {
    return [];
  }
}

export function pickWeightedKey<T extends string>(
  weights: Record<T, number>,
  explorationRate: number
): T {
  const keys = Object.keys(weights) as T[];
  if (Math.random() < explorationRate) {
    return keys[Math.floor(Math.random() * keys.length)];
  }
  const total = keys.reduce((acc, k) => acc + (weights[k] || 0), 0);
  let r = Math.random() * total;
  for (const k of keys) {
    r -= weights[k] || 0;
    if (r <= 0) return k;
  }
  return keys[0];
}
