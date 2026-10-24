import fs from 'fs';
import { google } from 'googleapis';
import { request } from 'undici';
import { CONFIG } from '../config.js';
import { isConfigured, Platform, PublishResult, VideoToPublish } from '../platforms.js';
import { Storyboard } from '../types.js';

const CREDENTIAL_KEYS: Record<Platform, string> = {
  youtube: 'set YOUTUBE_CLIENT_ID and YOUTUBE_REFRESH_TOKEN',
  instagram: 'set META_ACCESS_TOKEN and INSTAGRAM_BUSINESS_ACCOUNT_ID',
  facebook: 'set META_ACCESS_TOKEN and FACEBOOK_PAGE_ID',
};

/** A Post that went out: the Platform's ID for it, and its link. */
type Published = { id: string; url?: string };

const PUBLISHERS: Record<Platform, (mp4Path: string, script: Storyboard) => Promise<Published>> = {
  youtube: uploadToYouTubeShorts,
  instagram: uploadToInstagramReels,
  facebook: uploadToFacebookReels,
};

/**
 * Publishes the rendered vertical MP4 to one Platform, returning the Post's ID and link or the
 * error (it never throws):
 * - YouTube Shorts (via YouTube Data API v3)
 * - Instagram Reels (Graph API resumable upload)
 * - Facebook Page Reels (Graph API video_reels binary upload)
 */
export async function publishToPlatform(platform: Platform, video: VideoToPublish): Promise<PublishResult> {
  try {
    if (!isConfigured(platform, CONFIG)) throw new Error(`Not configured: ${CREDENTIAL_KEYS[platform]}.`);
    const { id, url } = await PUBLISHERS[platform](video.path, video.storyboard);
    return { platform, ok: true, id, url };
  } catch (err) {
    return { platform, ok: false, error: (err as Error).message || String(err) };
  }
}

/** Appends the credit line and source links that every platform description carries. */
function withCredits(text: string, script: Storyboard): string {
  const sources = script.sourceUrls.length > 0 ? `\nSource: ${script.sourceUrls.join('\n')}` : '';
  return `${text}\n\n${script.creditLine}${sources}`;
}

async function uploadToYouTubeShorts(
  mp4Path: string,
  script: Storyboard
): Promise<Published> {
  const oauth2Client = new google.auth.OAuth2(
    CONFIG.youtube.clientId,
    CONFIG.youtube.clientSecret
  );
  oauth2Client.setCredentials({ refresh_token: CONFIG.youtube.refreshToken });

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
  const titleWithTag = script.youtubeMetadata.title.includes('#Shorts')
    ? script.youtubeMetadata.title
    : `${script.youtubeMetadata.title.slice(0, 90)} #Shorts`;

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: titleWithTag,
        description: withCredits(script.youtubeMetadata.description, script),
        tags: script.youtubeMetadata.tags,
        categoryId: '27',
      },
      status: {
        privacyStatus: CONFIG.youtube.privacy,
        selfDeclaredMadeForKids: false,
        // Altered or synthetic content disclosure (AI visuals and voice). Not yet in the
        // googleapis typings, hence the spread.
        ...{ containsSyntheticMedia: true },
      },
    },
    media: {
      body: fs.createReadStream(mp4Path),
    },
  });

  if (!res.data.id) {
    throw new Error(`YouTube upload returned no video ID: ${JSON.stringify(res.data)}`);
  }
  return { id: res.data.id, url: `https://youtube.com/shorts/${res.data.id}` };
}

/**
 * Instagram Reels via the resumable upload flow: the MP4 bytes go straight to
 * rupload.facebook.com, so no public video URL or bucket is needed.
 */
async function uploadToInstagramReels(
  mp4Path: string,
  script: Storyboard
): Promise<Published> {
  const { accessToken, igBusinessId, graphVersion } = CONFIG.meta;
  const graph = `https://graph.facebook.com/${graphVersion}`;

  const createRes = await request(`${graph}/${igBusinessId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'REELS',
      upload_type: 'resumable',
      caption: `${script.instagramMetadata.caption}\n\n${script.creditLine}`,
      share_to_feed: true,
      // Meta's AI disclosure ("AI info" label).
      is_ai_generated: true,
      access_token: accessToken,
    }),
  });
  const createData = (await createRes.body.json()) as any;
  if (!createData.id) {
    throw new Error(`IG container creation failed: ${JSON.stringify(createData)}`);
  }
  const creationId = createData.id;

  const fileBuffer = fs.readFileSync(mp4Path);
  const uploadRes = await request(
    createData.uri || `https://rupload.facebook.com/ig-api-upload/${graphVersion}/${creationId}`,
    {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${accessToken}`,
        offset: '0',
        file_size: String(fileBuffer.byteLength),
      },
      body: fileBuffer,
    }
  );
  const uploadData = (await uploadRes.body.json()) as any;
  if (!uploadData.success) {
    throw new Error(`IG video upload failed: ${JSON.stringify(uploadData)}`);
  }

  // Meta recommends checking about once a minute for up to 5 minutes; never publish early.
  let status = 'IN_PROGRESS';
  for (const waitMs of [20_000, 40_000, 60_000, 60_000, 60_000, 60_000]) {
    await new Promise((r) => setTimeout(r, waitMs));
    const statusRes = await request(`${graph}/${creationId}?fields=status_code&access_token=${accessToken}`);
    status = ((await statusRes.body.json()) as any).status_code;
    if (status === 'FINISHED') break;
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new Error(`IG media processing ended with ${status}`);
    }
  }
  if (status !== 'FINISHED') {
    throw new Error(`IG media still ${status} after 5 minutes; not publishing.`);
  }

  const pubRes = await request(`${graph}/${igBusinessId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
  });
  const pubData = (await pubRes.body.json()) as any;
  if (!pubData.id) {
    throw new Error(`IG publish failed: ${JSON.stringify(pubData)}`);
  }

  // Needs the instagram_manage_comments permission.
  if (script.instagramMetadata.firstCommentPrompt) {
    await request(`${graph}/${pubData.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: script.instagramMetadata.firstCommentPrompt, access_token: accessToken }),
    }).catch(() => {});
  }

  // The Reel is live by now, so a failed link lookup must not turn it into a failed Post.
  const permalink = await request(`${graph}/${pubData.id}?fields=permalink&access_token=${accessToken}`)
    .then(async (res) => ((await res.body.json()) as any).permalink as string | undefined)
    .catch(() => undefined);
  return { id: pubData.id, url: permalink };
}

async function uploadToFacebookReels(
  mp4Path: string,
  script: Storyboard
): Promise<Published> {
  const { accessToken, fbPageId, graphVersion } = CONFIG.meta;

  const startUrl = `https://graph.facebook.com/${graphVersion}/${fbPageId}/video_reels`;
  const startRes = await request(startUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      upload_phase: 'start',
      access_token: accessToken,
    }),
  });
  const startData = (await startRes.body.json()) as any;
  if (!startData.video_id || !startData.upload_url) {
    throw new Error(`FB Reels start failed: ${JSON.stringify(startData)}`);
  }

  const fileBuffer = fs.readFileSync(mp4Path);
  const uploadRes = await request(startData.upload_url, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${accessToken}`,
      offset: '0',
      file_size: String(fileBuffer.byteLength),
      'Content-Type': 'application/octet-stream',
    },
    body: fileBuffer,
  });
  if (uploadRes.statusCode !== 200) {
    throw new Error(`FB Reels binary upload failed with HTTP ${uploadRes.statusCode}`);
  }

  const finishRes = await request(startUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: accessToken,
      video_id: startData.video_id,
      upload_phase: 'finish',
      video_state: 'PUBLISHED',
      // Meta's AI disclosure ("AI info" label).
      is_ai_generated: true,
      description: withCredits(`${script.facebookMetadata.title}\n\n${script.facebookMetadata.description}`, script),
    }),
  });
  const finishData = (await finishRes.body.json()) as any;
  if (!finishData.success) {
    throw new Error(`FB Reels publish failed: ${JSON.stringify(finishData)}`);
  }

  return { id: startData.video_id, url: `https://www.facebook.com/reel/${startData.video_id}` };
}
