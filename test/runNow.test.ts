import { describe, expect, it } from 'vitest';
import { startTestDaemon, visibleText } from './support/testDaemon.js';

// Tests run in Asia/Kolkata (UTC+05:30, see vitest.config.ts), so these times are local, not UTC.
const SUNDAY_10AM = new Date('2026-10-25T10:00');

/** The fields the page's one form would post, as a browser sends them. */
function formFields(page: string): Record<string, string> {
  const inputs = page.match(/<form[\s\S]*?<\/form>/)?.[0].matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g);
  return Object.fromEntries([...(inputs ?? [])].map(([, name, value]) => [name, value]));
}

/** The front page's Run now form. */
async function runNowForm(request: (pathname: string) => Response | Promise<Response>): Promise<string> {
  const page = await (await request('/')).text();
  const form = page.match(/<form method="post" action="\/actions\/run-now">[\s\S]*?<\/form>/);
  if (!form) throw new Error('The front page has no Run now form');
  return form[0];
}

describe('Run now', () => {
  it('has a form on the front page for Genre, image Provider, motion Provider, storyboard only and no upload', async () => {
    const { request, pageText } = startTestDaemon({ now: SUNDAY_10AM, env: { IMAGE_PROVIDER: 'fal' } });

    const form = await runNowForm(request);

    expect([...form.matchAll(/name="([^"]+)"/g)].map((match) => match[1])).toEqual([
      'genre',
      'images',
      'motion',
      'storyboard-only',
      'no-upload',
    ]);
    const page = await pageText('/');
    expect(page).toContain(
      'Genre Strategy picks reddit_revenge reddit_aita reddit_entitled reddit_workplace reddit_updates ' +
        'true_heists_cons true_vanished_unsolved true_survival true_business_blunders fiction_drama fiction_confessions'
    );
    expect(page).toContain('Image Provider Default (fal) gemini comfyui fal stock');
    expect(page).toContain('Motion Provider Default (none) none gemini fal comfyui');
    expect(page).toContain('Storyboard only');
    expect(page).toContain('No upload');
    expect(form).toMatch(/<button>Run now<\/button>/);
    expect(form).not.toContain('disabled');
  });

  it('disables the form while a Run is in progress, and enables it again once the Run ends', async () => {
    const { holdPipeline, post, request, pageText } = startTestDaemon({ now: SUNDAY_10AM });
    const held = holdPipeline(4);
    await post('/actions/run-now');

    expect(await runNowForm(request)).toContain('<fieldset disabled>');
    expect(await pageText('/')).toContain('Run now is off while a Run is in progress.');

    await held.release();

    expect(await runNowForm(request)).not.toContain('disabled');
    expect(await pageText('/')).not.toContain('Run now is off');
  });

  it('gives the options chosen in its form to that Run only; the next Run uses the defaults again', async () => {
    const { calls, post, settle } = startTestDaemon({ now: SUNDAY_10AM });

    const res = await post('/actions/run-now', {
      genre: 'true_survival',
      images: 'fal',
      motion: 'gemini',
      'storyboard-only': 'on',
      'no-upload': 'on',
    });
    await settle();
    await post('/actions/run-now');
    await settle();

    expect(res.status).toBe(303);
    expect(calls.pipelineOptions).toEqual([
      { genre: 'true_survival', imageProvider: 'fal', motionProvider: 'gemini', storyboardOnly: true, upload: false },
      {},
    ]);
  });

  it('warns when the Daily budget left is below the estimated cost of a Video, and starts the Run once confirmed', async () => {
    const { calls, generate, pipelineSpend, post, settle } = startTestDaemon({ now: SUNDAY_10AM });
    pipelineSpend.push(0.3);
    await generate({});

    const warning = await post('/actions/run-now', { genre: 'true_survival', 'no-upload': 'on' });

    expect(warning.status).toBe(200);
    const page = await warning.text();
    // 12 images at gemini's $0.034 (GEMINI_IMAGE_SIZE 1K), plus $0.01 of text.
    expect(visibleText(page)).toContain(
      'A Video with these options is estimated to cost $0.42 (12 gemini images, plus text), ' +
        "but only $0.20 of today's $0.50 Daily budget is left."
    );
    expect(calls.pipeline).toHaveLength(1);

    const confirmed = await post('/actions/run-now', formFields(page));
    await settle();

    expect(confirmed.status).toBe(303);
    expect(calls.pipelineOptions).toEqual([{}, { genre: 'true_survival', upload: false }]);
  });

  it('refuses Run now while a Run is in progress before any budget warning, as there would be nothing to confirm', async () => {
    const { calls, generate, holdPipeline, pipelineSpend, post } = startTestDaemon({ now: SUNDAY_10AM });
    pipelineSpend.push(0.45);
    await generate({});
    holdPipeline(4);
    await post('/actions/run-now', { images: 'comfyui' });

    const res = await post('/actions/run-now');

    expect(res.status).toBe(409);
    expect(await res.text()).toContain('Another Run is in progress');
    expect(calls.pipeline).toHaveLength(2);
  });

  it("doesn't warn when the options leave the Video within the Daily budget: free images, or storyboard only", async () => {
    const { calls, generate, pipelineSpend, post, settle } = startTestDaemon({ now: SUNDAY_10AM });
    pipelineSpend.push(0.45);
    await generate({});

    const freeImages = await post('/actions/run-now', { images: 'comfyui' });
    await settle();
    const storyboardOnly = await post('/actions/run-now', { 'storyboard-only': 'on' });
    await settle();

    expect([freeImages.status, storyboardOnly.status]).toEqual([303, 303]);
    expect(calls.pipeline).toHaveLength(3);
  });

  it('refuses a Genre or Provider it doesn\'t know, starting no Run', async () => {
    const { calls, post } = startTestDaemon({ now: SUNDAY_10AM });

    const genre = await post('/actions/run-now', { genre: 'cat_videos' });
    const images = await post('/actions/run-now', { images: 'dall-e' });
    const motion = await post('/actions/run-now', { motion: 'sora' });

    expect([genre.status, images.status, motion.status]).toEqual([400, 400, 400]);
    expect(await genre.text()).toBe('Unknown Genre "cat_videos".');
    expect(await images.text()).toBe('Unknown image Provider "dall-e".');
    expect(await motion.text()).toBe('Unknown motion Provider "sora".');
    expect(calls.pipeline).toEqual([]);
  });
});
