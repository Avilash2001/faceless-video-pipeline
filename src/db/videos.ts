import type { DatabaseSync } from 'node:sqlite';
import type { Platform, PublishResult } from '../platforms.js';
import type { PipelineResult, RenderedVideo } from '../types.js';

/**
 * Writes the legacy one-row-per-Story video record, which duplicate detection, recent-title
 * avoidance, metrics sync and evolve read. Re-rendering a saved storyboard updates its existing
 * row instead of failing the UNIQUE source id, keeping Platform IDs this Run didn't replace.
 */
export function recordVideo(
  database: DatabaseSync,
  result: PipelineResult,
  video: RenderedVideo,
  posts: PublishResult[]
): void {
  const postedId = (platform: Platform) => {
    const post = posts.find((p) => p.platform === platform);
    return post?.ok ? post.id : null;
  };
  database
    .prepare(
      `INSERT INTO videos (
        source_external_id, source_url, niche, hook_archetype, voice_name,
        strategy_version, script_json, duration_sec, mp4_path,
        yt_video_id, ig_media_id, fb_video_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_external_id) DO UPDATE SET
        voice_name = excluded.voice_name,
        script_json = excluded.script_json,
        duration_sec = excluded.duration_sec,
        mp4_path = excluded.mp4_path,
        yt_video_id = COALESCE(excluded.yt_video_id, yt_video_id),
        ig_media_id = COALESCE(excluded.ig_media_id, ig_media_id),
        fb_video_id = COALESCE(excluded.fb_video_id, fb_video_id)`
    )
    .run(
      result.story.candidate.externalId,
      result.story.candidate.sourceUrl || '',
      result.storyboard.niche,
      result.storyboard.hookArchetype,
      video.voiceName,
      result.strategyVersion,
      JSON.stringify(result.storyboard),
      video.durationSec,
      video.path,
      postedId('youtube'),
      postedId('instagram'),
      postedId('facebook')
    );
}
