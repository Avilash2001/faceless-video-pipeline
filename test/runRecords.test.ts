import { describe, expect, it } from 'vitest';
import { OverBudgetError } from '../src/spend.js';
import { startTestDaemon } from './support/testDaemon.js';

// Tests run in Asia/Kolkata (UTC+05:30, see vitest.config.ts), so these times are local, not UTC.
const SUNDAY_10AM = new Date('2026-10-25T10:00');
const AFTER_FIRST_SLOT = new Date('2026-10-25T19:00');

/** "/runs/<id>" → "<id>". */
const runId = (runPage: string) => runPage.replace('/runs/', '');

/** The Run pages the Runs list links to, newest Run first. */
async function runPages(request: (pathname: string) => Response | Promise<Response>): Promise<string[]> {
  const html = await (await request('/runs')).text();
  return [...html.matchAll(/href="(\/runs\/[^"]+)"/g)].map((match) => match[1]);
}

describe('Run records', () => {
  it("lists a Slot's Run with its start, outcome, Genre, title, length and cost", async () => {
    const { clock, pipelineSpend, pageText } = startTestDaemon({ now: SUNDAY_10AM });
    pipelineSpend.push(0.12);

    await clock.advanceTo(AFTER_FIRST_SLOT);

    expect(await pageText('/runs')).toContain(
      'Sun 25 Oct 18:00 rendered true_heists_cons · They beat the vault · 42 s · $0.12'
    );
  });

  it("shows a Run's page with what started it, its cost as the spend recorded against it, and its run log", async () => {
    const { clock, generate, pipelineSpend, request, pageText } = startTestDaemon({ now: SUNDAY_10AM });
    pipelineSpend.push(0.12, 0.3);

    await generate({});
    await clock.advanceTo(AFTER_FIRST_SLOT);

    const [slotRun, commandLineRun] = await runPages(request);
    const page = await pageText(slotRun);
    expect(page).toContain('Started Sun 25 Oct 18:00 by a Slot');
    expect(page).toContain('Cost $0.30 (≈ ₹31 incl. tax)');
    expect(page).toContain('Run log [Pipeline] Run ');
    expect(page).toContain('[Pipeline] 6/7 Rendering 1080x1920 MP4...');
    expect(page).toContain('[Pipeline] Run complete! API spend for this video: $0.30');
    expect(await pageText(commandLineRun)).toContain('Started Sun 25 Oct 10:00 by the command line');
  });

  it('answers 404 for a Run it has no record of', async () => {
    const { request } = startTestDaemon({ now: SUNDAY_10AM });

    expect((await request('/runs/no-such-run')).status).toBe(404);
  });

  it('records a Run that fails at step 5 as failed at step 5, with the error at the top of its page', async () => {
    const { generate, failures, request, pageText } = startTestDaemon({ now: SUNDAY_10AM });
    failures.pipeline = new Error('Only 3 of 9 shots could be generated');
    failures.pipelineStep = 5;

    await expect(generate({})).rejects.toThrow('Only 3 of 9 shots could be generated');

    const list = await (await request('/runs')).text();
    expect(list).toContain('<strong class="failed">failed at step 5</strong>');
    const [run] = await runPages(request);
    const page = await pageText(run);
    const failure = page.indexOf('Failed at step 5 of 7 Only 3 of 9 shots could be generated');
    expect(failure).toBeGreaterThanOrEqual(0);
    expect(failure).toBeLessThan(page.indexOf('Outcome'));
    expect(page).toContain('Run log [Pipeline] Run ');
  });

  it('records a Daily budget stop as failed with the reason "over budget", shown in amber', async () => {
    const { generate, failures, request, pageText } = startTestDaemon({ now: SUNDAY_10AM });
    failures.pipeline = new OverBudgetError('Daily budget reached: gemini would cost ~$0.41');
    failures.pipelineStep = 5;

    await expect(generate({})).rejects.toThrow('Daily budget reached');

    const list = await (await request('/runs')).text();
    expect(list).toContain('<strong class="amber">failed: over budget</strong>');
    const [run] = await runPages(request);
    expect(await (await request(run)).text()).toContain('<section class="failure amber">');
    expect(await pageText(run)).toContain('Failed at step 5 of 7: over budget Daily budget reached: gemini would cost ~$0.41');
  });

  it('records a storyboard-only Run as storyboard only, with its Genre and title but no length', async () => {
    const { generate, pageText } = startTestDaemon({ now: SUNDAY_10AM });

    await generate({ storyboardOnly: true });

    expect(await pageText('/runs')).toContain(
      'Sun 25 Oct 10:00 storyboard only true_heists_cons · They beat the vault · $0.00'
    );
  });

  it('Run now starts a Run through the Pipeline, listed in progress until it ends, then with its outcome', async () => {
    const { calls, holdPipeline, post, request, pageText } = startTestDaemon({ now: SUNDAY_10AM });
    const held = holdPipeline(4);

    const res = await post('/actions/run-now');

    expect(res.status).toBe(303);
    const [run] = await runPages(request);
    expect(res.headers.get('location')).toBe(run);
    expect(calls.pipeline).toEqual([SUNDAY_10AM]);
    expect(await pageText('/runs')).toContain('Sun 25 Oct 10:00 in progress true_heists_cons · They beat the vault');
    expect(await pageText(run)).toContain('Started Sun 25 Oct 10:00 by Run now');

    await held.release();

    expect(await pageText('/runs')).toContain('Sun 25 Oct 10:00 rendered true_heists_cons · They beat the vault · 42 s');
  });

  it('refuses Run now while a Run is in progress, naming that Run', async () => {
    const { calls, holdPipeline, post, request } = startTestDaemon({ now: SUNDAY_10AM });
    holdPipeline(4);
    await post('/actions/run-now');
    const [run] = await runPages(request);

    const res = await post('/actions/run-now');

    expect(res.status).toBe(409);
    expect(await res.text()).toBe(
      `Another Run is in progress: ${runId(run)}, started Sun 25 Oct 10:00 by Run now. Try again once it has finished.`
    );
    expect(calls.pipeline).toHaveLength(1);
    expect(await runPages(request)).toEqual([run]);
  });

  it('refuses a command-line Run while a Run is in progress, naming that Run, and allows one once it ends', async () => {
    const { clock, calls, generate, holdPipeline, request } = startTestDaemon({ now: SUNDAY_10AM });
    const held = holdPipeline(4);
    await clock.advanceTo(AFTER_FIRST_SLOT);
    const [slotRun] = await runPages(request);

    await expect(generate({})).rejects.toThrow(
      `Another Run is in progress: ${runId(slotRun)}, started Sun 25 Oct 18:00 by a Slot.`
    );
    expect(calls.pipeline).toHaveLength(1);

    await held.release();
    await generate({});

    expect(calls.pipeline).toHaveLength(2);
  });

  it('marks a Run left in progress failed ("interrupted") when the Daemon starts, so Runs can start again', async () => {
    const { calls, generate, holdPipeline, post, request, restart, pageText } = startTestDaemon({ now: SUNDAY_10AM });
    holdPipeline(4);
    await post('/actions/run-now');
    const [run] = await runPages(request);

    await restart({});

    expect(await pageText('/runs')).toContain(
      'Sun 25 Oct 10:00 failed: interrupted true_heists_cons · They beat the vault'
    );
    expect(await pageText(run)).toContain('Failed at step 4 of 7: interrupted');
    await generate({});
    expect(calls.pipeline).toHaveLength(2);
  });

  it('marks a command-line Run stopped with Ctrl-C failed ("interrupted") at once, so the next Run can start', async () => {
    const { calls, generate, holdPipeline, startGenerate, request, pageText } = startTestDaemon({ now: SUNDAY_10AM });
    holdPipeline(4);
    const commandLine = await startGenerate({});
    const [run] = await runPages(request);

    await commandLine.stopWithSignal();

    expect(await pageText('/runs')).toContain(
      'Sun 25 Oct 10:00 failed: interrupted true_heists_cons · They beat the vault'
    );
    expect(await pageText(run)).toContain('Failed at step 4 of 7: interrupted');
    await generate({});
    expect(calls.pipeline).toHaveLength(2);
  });

  it("stopping a command-line Run that was refused leaves the daemon's Run in progress alone", async () => {
    const { holdPipeline, post, startGenerate, pageText } = startTestDaemon({ now: SUNDAY_10AM });
    holdPipeline(4);
    await post('/actions/run-now');
    const commandLine = await startGenerate({});
    await expect(commandLine.done).rejects.toThrow('Another Run is in progress');

    await commandLine.stopWithSignal();

    expect(await pageText('/runs')).toContain('Sun 25 Oct 10:00 in progress');
  });

  it('keeps the log of a Run that failed before it had a folder, and shows it on its page', async () => {
    const { generate, failures, request, pageText } = startTestDaemon({ now: SUNDAY_10AM });
    failures.pipeline = new Error('No story candidates for reddit_revenge');

    await expect(generate({ genre: 'reddit_revenge' })).rejects.toThrow('No story candidates');

    const [run] = await runPages(request);
    expect(await pageText('/runs')).toContain('Sun 25 Oct 10:00 failed at step 1 reddit_revenge · $0.00');
    expect(await pageText(run)).toContain(
      `Run log [Pipeline] Run ${runId(run)} [Pipeline] 1/7 Finding story candidates... ` +
        '[Pipeline] Run failed: Error: No story candidates for reddit_revenge'
    );
  });
});
