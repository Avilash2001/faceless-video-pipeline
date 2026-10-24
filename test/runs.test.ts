import { describe, expect, it } from 'vitest';
import { startTestDaemon } from './support/testDaemon.js';

const SUNDAY_10AM = new Date('2026-10-25T10:00');
const AFTER_FIRST_SLOT = new Date('2026-10-25T19:00');
/** Auto-upload on, with credentials for every Platform. */
const AUTO_UPLOAD = {
  ENABLE_AUTO_UPLOAD: 'true',
  YOUTUBE_CLIENT_ID: 'yt-client',
  YOUTUBE_REFRESH_TOKEN: 'yt-refresh',
  META_ACCESS_TOKEN: 'meta-token',
  INSTAGRAM_BUSINESS_ACCOUNT_ID: 'ig-account',
  FACEBOOK_PAGE_ID: 'fb-page',
};

/** The run log's progress lines, one per step reached. */
function stepLines(log: string): string[] {
  return log.split('\n').filter((line) => /^\[Pipeline\] \d\/7 /.test(line));
}

describe('Runs', () => {
  it("keeps each Run's log in its folder, with steps 1 to 7 in order", async () => {
    const { clock, runLogs } = startTestDaemon({ now: SUNDAY_10AM });

    await clock.advanceTo(AFTER_FIRST_SLOT);

    const logs = runLogs();
    expect(logs).toHaveLength(1);
    expect(stepLines(logs[0])).toEqual([
      '[Pipeline] 1/7 Finding story candidates...',
      '[Pipeline] 2/7 Choosing and briefing the story...',
      '[Pipeline] 3/7 Writing the storyboard...',
      '[Pipeline] 4/7 Synthesizing voiceover...',
      '[Pipeline] 5/7 Generating scene visuals...',
      '[Pipeline] 6/7 Rendering 1080x1920 MP4...',
      '[Pipeline] 7/7 Upload skipped (ENABLE_AUTO_UPLOAD=false or --no-upload). Saved locally.',
    ]);
  });

  it('with auto-upload on, publishes the Video to each Platform with one call each', async () => {
    const { clock, calls, runLogs } = startTestDaemon({ now: SUNDAY_10AM, env: AUTO_UPLOAD });

    await clock.advanceTo(AFTER_FIRST_SLOT);

    expect(calls.publish.map((call) => call.platform)).toEqual(['youtube', 'instagram', 'facebook']);
    const [log] = runLogs();
    expect(stepLines(log).at(-1)).toBe(
      '[Pipeline] 7/7 Publishing to YouTube Shorts, Instagram Reels, and Facebook Reels...'
    );
    expect(log).toContain('[Publisher] YouTube: https://youtube.example/1');
    expect(log).toContain('[Publisher] Instagram: https://instagram.example/2');
    expect(log).toContain('[Publisher] Facebook: https://facebook.example/3');
  });

  it("keeps each Platform's result separate: one failing doesn't stop the others", async () => {
    const { clock, calls, failures, runLogs } = startTestDaemon({
      now: SUNDAY_10AM,
      env: AUTO_UPLOAD,
    });
    failures.publish.instagram = 'Media upload has failed with error code 2207026';

    await clock.advanceTo(AFTER_FIRST_SLOT);

    expect(calls.publish.map((call) => call.platform)).toEqual(['youtube', 'instagram', 'facebook']);
    const [log] = runLogs();
    expect(log).toContain('[Publisher] YouTube: https://youtube.example/1');
    expect(log).toContain('[Publisher] Instagram failed: Media upload has failed with error code 2207026');
    expect(log).toContain('[Publisher] Facebook: https://facebook.example/3');
  });

  it('skips a Platform without credentials, as before, and publishes to the rest', async () => {
    const { clock, calls, runLogs } = startTestDaemon({
      now: SUNDAY_10AM,
      env: { ENABLE_AUTO_UPLOAD: 'true', YOUTUBE_CLIENT_ID: 'yt-client', YOUTUBE_REFRESH_TOKEN: 'yt-refresh' },
    });

    await clock.advanceTo(AFTER_FIRST_SLOT);

    expect(calls.publish.map((call) => call.platform)).toEqual(['youtube']);
    const [log] = runLogs();
    expect(log).toContain('[Publisher] YouTube: https://youtube.example/1');
    expect(log).toContain('[Publisher] Skipping Instagram (not configured).');
    expect(log).toContain('[Publisher] Skipping Facebook (not configured).');
    expect(log).not.toContain('failed');
  });

  it("ends a failed Run's log with its error", async () => {
    const { generate, failures, runLogs } = startTestDaemon({ now: SUNDAY_10AM });
    failures.pipeline = new Error('Only 3 of 9 shots could be generated');
    failures.pipelineStep = 5;

    await expect(generate({})).rejects.toThrow('Only 3 of 9 shots could be generated');

    const lines = runLogs()[0].trimEnd().split('\n');
    expect(stepLines(lines.join('\n')).at(-1)).toBe('[Pipeline] 5/7 Generating scene visuals...');
    expect(lines.find((line) => line.startsWith('[Pipeline] Run failed'))).toBe(
      '[Pipeline] Run failed: Error: Only 3 of 9 shots could be generated'
    );
  });

  it('publishes nothing from a command-line Run with --no-upload, even with auto-upload on', async () => {
    const { generate, calls, runLogs } = startTestDaemon({ now: SUNDAY_10AM, env: AUTO_UPLOAD });

    await generate({ upload: false });

    expect(calls.publish).toEqual([]);
    expect(stepLines(runLogs()[0]).at(-1)).toBe(
      '[Pipeline] 7/7 Upload skipped (ENABLE_AUTO_UPLOAD=false or --no-upload). Saved locally.'
    );
  });

  it('gives each Run only its own options', async () => {
    const { clock, generate, calls } = startTestDaemon({
      now: SUNDAY_10AM,
      // As if started with `pnpm daemon --images comfyui`.
      slotOptions: { imageProvider: 'comfyui' },
    });

    await generate({ imageProvider: 'fal', motionProvider: 'gemini', genre: 'true_survival' });
    await clock.advanceTo(AFTER_FIRST_SLOT);

    expect(calls.pipelineOptions).toEqual([
      { imageProvider: 'fal', motionProvider: 'gemini', genre: 'true_survival' },
      { imageProvider: 'comfyui' },
    ]);
  });

  it("reports each Run's own spend, apart from the rest of today's", async () => {
    const { generate, pipelineSpend, runLogs } = startTestDaemon({ now: SUNDAY_10AM, env: { DAILY_BUDGET_USD: '1' } });
    pipelineSpend.push(0.12, 0.3);

    await generate({});
    await generate({});

    const [first, second] = runLogs();
    expect(first).toContain('[Pipeline] Run complete! API spend for this video: $0.12 (≈ ₹12 incl. tax);');
    expect(second).toContain(
      '[Pipeline] Run complete! API spend for this video: $0.30 (≈ ₹31 incl. tax); ' +
        'today: $0.42 (≈ ₹44 incl. tax) of the $1 daily budget.'
    );
  });

  it('stops a storyboard-only Run after step 3, publishing nothing', async () => {
    const { generate, calls, runLogs } = startTestDaemon({ now: SUNDAY_10AM, env: AUTO_UPLOAD });

    await generate({ storyboardOnly: true });

    expect(calls.publish).toEqual([]);
    expect(stepLines(runLogs()[0])).toEqual([
      '[Pipeline] 1/7 Finding story candidates...',
      '[Pipeline] 2/7 Choosing and briefing the story...',
      '[Pipeline] 3/7 Writing the storyboard...',
    ]);
  });
});
