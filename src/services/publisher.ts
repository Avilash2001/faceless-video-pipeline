import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { request } from 'undici';
import { CONFIG } from '../config.js';
import { Storyboard, PlatformUploadResult } from '../types.js';

/**
 * Publishes the rendered vertical MP4 concurrently to:
 * 1. YouTube Shorts (via YouTube Data API v3)
 * 2. Instagram Reels (via Instagram Graph API v21.0)
 * 3. Facebook Page Reels (via Facebook Video Reels Binary Upload API v21.0)
 */
export async function publishAcrossPlatforms(
  mp4Path: string,
  script: Storyboard
): Promise<PlatformUploadResult> {
  const result: PlatformUploadResult = { errors: [] };

  const tasks = await Promise.allSettled([
    uploadToYouTubeShorts(mp4Path, script),
    uploadToInstagramReels(mp4Path, script),
    uploadToFacebookReels(mp4Path, script),
  ]);

  if (tasks[0].status === 'fulfilled' && tasks[0].value) {
    result.youtubeVideoId = tasks[0].value;
  } else if (tasks[0].status === 'rejected') {
    result.errors.push(`YouTube: ${tasks[0].reason}`);
  }

  if (tasks[1].status === 'fulfilled' && tasks[1].value) {
    result.instagramMediaId = tasks[1].value;
  } else if (tasks[1].status === 'rejected') {
    result.errors.push(`Instagram: ${tasks[1].reason}`);
  }

  if (tasks[2].status === 'fulfilled' && tasks[2].value) {
    result.facebookVideoId = tasks[2].value;
  } else if (tasks[2].status === 'rejected') {
    result.errors.push(`Facebook: ${tasks[2].reason}`);
  }

  return result;
}

/** Appends the credit line and source links that every platform description carries. */
function withCredits(text: string, script: Storyboard): string {
  const sources = script.sourceUrls.length > 0 ? `\nSource: ${script.sourceUrls.join('\n')}` : '';
  return `${text}\n\n${script.creditLine}${sources}`;
}

async function uploadToYouTubeShorts(
  mp4Path: string,
  script: Storyboard
): Promise<string | undefined> {
  if (
    !CONFIG.youtube.clientId ||
    !CONFIG.youtube.refreshToken ||
    CONFIG.youtube.clientId.includes('your_') ||
    CONFIG.youtube.refreshToken.includes('your_')
  ) {
    console.log('[Publisher] Skipping YouTube upload (credentials not configured).');
    return undefined;
  }

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

  return res.data.id || undefined;
}

async function uploadToInstagramReels(
  mp4Path: string,
  script: Storyboard
): Promise<string | undefined> {
  const { accessToken, igBusinessId, publicVideoBaseUrl } = CONFIG.meta;
  if (
    !accessToken ||
    !igBusinessId ||
    !publicVideoBaseUrl ||
    accessToken.includes('your_') ||
    igBusinessId.includes('your_') ||
    publicVideoBaseUrl.includes('yourdomain.com')
  ) {
    console.log('[Publisher] Skipping Instagram Reels (META_ACCESS_TOKEN or PUBLIC_VIDEO_BASE_URL not configured).');
    return undefined;
  }

  const fileName = path.basename(mp4Path);
  const publicVideoUrl = `${publicVideoBaseUrl.replace(/\/$/, '')}/${fileName}`;

  const createUrl = `https://graph.facebook.com/v21.0/${igBusinessId}/media`;
  const createRes = await request(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'REELS',
      video_url: publicVideoUrl,
      caption: `${script.instagramMetadata.caption}\n\n${script.creditLine}`,
      share_to_feed: true,
      access_token: accessToken,
    }),
  });

  const createData = (await createRes.body.json()) as any;
  if (!createData.id) {
    throw new Error(`IG container creation failed: ${JSON.stringify(createData)}`);
  }

  const creationId = createData.id;

  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise((r) => setTimeout(r, 6000));
    const statusRes = await request(
      `https://graph.facebook.com/v21.0/${creationId}?fields=status_code&access_token=${accessToken}`
    );
    const statusData = (await statusRes.body.json()) as any;
    if (statusData.status_code === 'FINISHED') break;
    if (statusData.status_code === 'ERROR') {
      throw new Error(`IG media processing error: ${JSON.stringify(statusData)}`);
    }
  }

  const pubRes = await request(
    `https://graph.facebook.com/v21.0/${igBusinessId}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: creationId,
        access_token: accessToken,
      }),
    }
  );
  const pubData = (await pubRes.body.json()) as any;

  if (pubData.id && script.instagramMetadata.firstCommentPrompt) {
    await request(
      `https://graph.facebook.com/v21.0/${pubData.id}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: script.instagramMetadata.firstCommentPrompt,
          access_token: accessToken,
        }),
      }
    ).catch(() => {});
  }

  return pubData.id;
}

async function uploadToFacebookReels(
  mp4Path: string,
  script: Storyboard
): Promise<string | undefined> {
  const { accessToken, fbPageId } = CONFIG.meta;
  if (
    !accessToken ||
    !fbPageId ||
    accessToken.includes('your_') ||
    fbPageId.includes('your_')
  ) {
    console.log('[Publisher] Skipping Facebook Reels (META_ACCESS_TOKEN or FACEBOOK_PAGE_ID not configured).');
    return undefined;
  }

  const startUrl = `https://graph.facebook.com/v21.0/${fbPageId}/video_reels`;
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
      description: withCredits(`${script.facebookMetadata.title}\n\n${script.facebookMetadata.description}`, script),
    }),
  });
  const finishData = (await finishRes.body.json()) as any;
  if (!finishData.success) {
    throw new Error(`FB Reels publish failed: ${JSON.stringify(finishData)}`);
  }

  return startData.video_id;
}
