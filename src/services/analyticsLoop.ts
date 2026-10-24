import fs from 'fs';
import { google } from 'googleapis';
import { Type } from '@google/genai';
import { request } from 'undici';
import { CONFIG } from '../config.js';
import { db } from '../db/index.js';
import { StrategyRules } from '../types.js';
import { generateContentWithFallback } from './gemini.js';


/**
 * 1. Pulls 48h+ telemetry across YouTube Analytics API, Instagram Graph Insights,
 *    and Facebook Video Insights for recent uploads.
 * 2. Computes a unified Composite Reward Score (weighting retention %, saves/shares, and log views).
 */
export async function syncCrossPlatformMetrics(): Promise<void> {
  const recentVideos = db
    .prepare(
      `SELECT id, yt_video_id, ig_media_id, fb_video_id, duration_sec
       FROM videos
       WHERE created_at <= datetime('now', '-24 hours')
       ORDER BY id DESC LIMIT 40`
    )
    .all() as any[];

  const snapshotDate = new Date().toISOString().slice(0, 10);

  for (const v of recentVideos) {
    const yt = v.yt_video_id ? await fetchYouTubeMetrics(v.yt_video_id) : null;
    const ig = v.ig_media_id
      ? await fetchInstagramMetrics(v.ig_media_id, v.duration_sec)
      : null;
    const fb = v.fb_video_id
      ? await fetchFacebookMetrics(v.fb_video_id, v.duration_sec)
      : null;

    const totalViews = (yt?.views || 0) + (ig?.plays || 0) + (fb?.views || 0);
    const totalSharesAndSaves =
      (yt?.shares || 0) + (ig?.saves || 0) + (ig?.shares || 0) + (fb?.shares || 0);

    const retentionSamples = [
      yt?.avgViewPct,
      ig?.avgWatchPct,
      fb?.avgWatchPct,
    ].filter((val): val is number => typeof val === 'number' && val > 0);

    const avgRetentionPct =
      retentionSamples.length > 0
        ? retentionSamples.reduce((a, b) => a + b, 0) / retentionSamples.length
        : 0;

    const shareRatePct =
      totalViews > 0 ? (totalSharesAndSaves / totalViews) * 100 : 0;

    const compositeReward =
      avgRetentionPct * 0.55 +
      Math.min(40, shareRatePct * 12) * 0.25 +
      Math.log10(totalViews + 1) * 8 * 0.2;

    db.prepare(
      `INSERT INTO video_metrics (
        video_id, snapshot_date,
        yt_views, yt_avg_view_pct, yt_likes, yt_comments, yt_shares,
        ig_plays, ig_avg_watch_pct, ig_saves, ig_shares, ig_comments,
        fb_views, fb_avg_watch_pct, fb_reactions, fb_shares,
        composite_reward_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id, snapshot_date) DO UPDATE SET
        yt_views=excluded.yt_views,
        yt_avg_view_pct=excluded.yt_avg_view_pct,
        ig_plays=excluded.ig_plays,
        ig_avg_watch_pct=excluded.ig_avg_watch_pct,
        fb_views=excluded.fb_views,
        fb_avg_watch_pct=excluded.fb_avg_watch_pct,
        composite_reward_score=excluded.composite_reward_score`
    ).run(
      v.id,
      snapshotDate,
      yt?.views || 0,
      yt?.avgViewPct || 0,
      yt?.likes || 0,
      yt?.comments || 0,
      yt?.shares || 0,
      ig?.plays || 0,
      ig?.avgWatchPct || 0,
      ig?.saves || 0,
      ig?.shares || 0,
      ig?.comments || 0,
      fb?.views || 0,
      fb?.avgWatchPct || 0,
      fb?.reactions || 0,
      fb?.shares || 0,
      Number(compositeReward.toFixed(2))
    );
  }
}

/**
 * Weekly Critic Loop:
 * Queries top-performing and bottom-performing videos, feeds their scripts, niches,
 * hook archetypes, and retention metrics to Gemini, and rewrites strategy_rules.json.
 */
export async function evolveStrategyRules(): Promise<StrategyRules> {
  const currentRules: StrategyRules = JSON.parse(
    fs.readFileSync(CONFIG.paths.strategyFile, 'utf-8')
  );

  const rankedVideos = db
    .prepare(
      `SELECT v.id, v.niche, v.hook_archetype, v.duration_sec, v.script_json,
              MAX(m.composite_reward_score) as reward,
              MAX(m.yt_avg_view_pct) as yt_ret,
              MAX(m.ig_avg_watch_pct) as ig_ret,
              MAX(m.fb_avg_watch_pct) as fb_ret,
              MAX(m.yt_views + m.ig_plays + m.fb_views) as total_views
       FROM videos v
       JOIN video_metrics m ON v.id = m.video_id
       GROUP BY v.id
       HAVING total_views > 10
       ORDER BY reward DESC`
    )
    .all() as any[];

  if (rankedVideos.length < 4) {
    console.log('[AnalyticsLoop] Fewer than 4 scored videos; keeping current strategy rules.');
    return currentRules;
  }

  const topPerformers = rankedVideos.slice(0, 4);
  const bottomPerformers = rankedVideos.slice(-4);

  const prompt = `You are a Quantitative Content Optimization Engine analyzing 7-day telemetry across YouTube Shorts, Instagram Reels, and Facebook Reels.

CURRENT STRATEGY RULES:
${JSON.stringify(currentRules, null, 2)}

TOP PERFORMING VIDEOS (HIGH RETENTION & SHARES):
${JSON.stringify(topPerformers, null, 2)}

BOTTOM PERFORMING VIDEOS (HIGH SWIPE-AWAY / LOW RETENTION):
${JSON.stringify(bottomPerformers, null, 2)}

TASK:
1. Re-weight "nicheWeights" (must sum to 1.0, keep every genre >= 0.04 so exploration continues).
2. Re-weight "hookArchetypeWeights" (must sum to 1.0) toward the hooks that achieved the highest average watch percentage.
3. Adjust "targetDurationSeconds" toward the duration sweet spot of the top performers.
4. Synthesize 4 concrete "doRules" and 3 "dontRules" based on structural differences between the winning scripts and losing scripts.`;

  const response = await generateContentWithFallback({
    label: 'strategy-evolve',
    contents: prompt,
    responseSchema: {
      type: Type.OBJECT,
      required: [
        'targetDurationSeconds',
        'nicheWeights',
        'hookArchetypeWeights',
        'doRules',
        'dontRules',
        'criticSummary',
      ],
      properties: {
        targetDurationSeconds: {
          type: Type.OBJECT,
          required: ['min', 'max'],
          properties: {
            min: { type: Type.INTEGER },
            max: { type: Type.INTEGER },
          },
        },
        nicheWeights: weightsSchema(Object.keys(currentRules.nicheWeights)),
        hookArchetypeWeights: weightsSchema(Object.keys(currentRules.hookArchetypeWeights)),
        doRules: { type: Type.ARRAY, items: { type: Type.STRING } },
        dontRules: { type: Type.ARRAY, items: { type: Type.STRING } },
        criticSummary: { type: Type.STRING },
      },
    },
  });

  const mutated = JSON.parse(response.text || '{}');
  const nextRules: StrategyRules = {
    ...currentRules,
    version: currentRules.version + 1,
    updatedAt: new Date().toISOString(),
    targetDurationSeconds: mutated.targetDurationSeconds,
    nicheWeights: mutated.nicheWeights,
    hookArchetypeWeights: mutated.hookArchetypeWeights,
    doRules: mutated.doRules,
    dontRules: mutated.dontRules,
  };

  fs.writeFileSync(
    CONFIG.paths.strategyFile,
    JSON.stringify(nextRules, null, 2),
    'utf-8'
  );

  db.prepare(
    `INSERT INTO strategy_history (version, rules_json, critic_summary) VALUES (?, ?, ?)`
  ).run(nextRules.version, JSON.stringify(nextRules), mutated.criticSummary || '');

  console.log(`[AnalyticsLoop] Evolved strategy to v${nextRules.version}: ${mutated.criticSummary}`);
  return nextRules;
}

async function fetchYouTubeMetrics(videoId: string) {
  if (!CONFIG.youtube.clientId || !CONFIG.youtube.refreshToken) return null;
  try {
    const oauth2Client = new google.auth.OAuth2(
      CONFIG.youtube.clientId,
      CONFIG.youtube.clientSecret
    );
    oauth2Client.setCredentials({ refresh_token: CONFIG.youtube.refreshToken });
    const ytAnalytics = google.youtubeAnalytics({ version: 'v2', auth: oauth2Client });

    const endDate = new Date().toISOString().slice(0, 10);
    const res = await ytAnalytics.reports.query({
      ids: 'channel==MINE',
      startDate: '2026-01-01',
      endDate,
      metrics: 'views,averageViewPercentage,likes,comments,shares',
      filters: `video==${videoId}`,
    });

    const row = res.data.rows?.[0];
    if (!row) return null;
    return {
      views: Number(row[0] || 0),
      avgViewPct: Number(row[1] || 0),
      likes: Number(row[2] || 0),
      comments: Number(row[3] || 0),
      shares: Number(row[4] || 0),
    };
  } catch {
    return null;
  }
}

async function fetchInstagramMetrics(mediaId: string, durationSec: number) {
  if (!CONFIG.meta.accessToken) return null;
  try {
    // `plays` was retired for Reels; `views` replaces it.
    const url = `https://graph.facebook.com/${CONFIG.meta.graphVersion}/${mediaId}/insights?metric=views,saved,shares,comments,ig_reels_avg_watch_time&access_token=${CONFIG.meta.accessToken}`;
    const res = await request(url);
    if (res.statusCode !== 200) return null;
    const data = (await res.body.json()) as any;
    const map: Record<string, number> = {};
    for (const item of data?.data || []) {
      map[item.name] = Number(item.values?.[0]?.value || 0);
    }
    const avgWatchSec = (map.ig_reels_avg_watch_time || 0) / 1000;
    return {
      plays: map.views || 0,
      saves: map.saved || 0,
      shares: map.shares || 0,
      comments: map.comments || 0,
      avgWatchPct: durationSec > 0 ? (avgWatchSec / durationSec) * 100 : 0,
    };
  } catch {
    return null;
  }
}

async function fetchFacebookMetrics(videoId: string, durationSec: number) {
  if (!CONFIG.meta.accessToken) return null;
  try {
    // Reels report plays and watch time under their own metric names.
    const url = `https://graph.facebook.com/${CONFIG.meta.graphVersion}/${videoId}/video_insights?metric=blue_reels_play_count,post_video_avg_time_watched&access_token=${CONFIG.meta.accessToken}`;
    const res = await request(url);
    if (res.statusCode !== 200) return null;
    const data = (await res.body.json()) as any;
    const map: Record<string, number> = {};
    for (const item of data?.data || []) {
      map[item.name] = Number(item.values?.[0]?.value || 0);
    }
    const avgWatchSec = (map.post_video_avg_time_watched || 0) / 1000;
    return {
      views: map.blue_reels_play_count || 0,
      avgWatchPct: durationSec > 0 ? (avgWatchSec / durationSec) * 100 : 0,
      reactions: 0,
      shares: 0,
    };
  } catch {
    return null;
  }
}

/** JSON schema for a weights object whose keys come from the current strategy file. */
function weightsSchema(keys: string[]) {
  return {
    type: Type.OBJECT,
    required: keys,
    properties: Object.fromEntries(keys.map((k) => [k, { type: Type.NUMBER }])),
  };
}
