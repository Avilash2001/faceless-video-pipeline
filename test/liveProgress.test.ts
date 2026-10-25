import { describe, expect, it } from 'vitest';
import { startTestDaemon, type StreamEvent } from './support/testDaemon.js';

// Tests run in Asia/Kolkata (UTC+05:30, see vitest.config.ts), so these times are local, not UTC.
const SUNDAY_10AM = new Date('2026-10-25T10:00');

/** Starts a Run with Run now; its id, from the Run page it leads to. */
async function runNow(post: (pathname: string) => Response | Promise<Response>): Promise<string> {
  return (await post('/actions/run-now')).headers.get('location')!.replace('/runs/', '');
}

/** An event on one line: "run: <id>", "step 4: Synthesizing voiceover...", "log 7: <line>". */
function summary({ event, data }: StreamEvent): string {
  const d = data as { run: string | null; step?: number; message?: string; index?: number; line?: string };
  if (event === 'run') return `run: ${d.run ?? 'none'}`;
  if (event === 'step') return `step ${d.step}: ${d.message}`;
  if (event === 'log') return `log ${d.index}: ${d.line}`;
  return `${event}: ${JSON.stringify(data)}`;
}

describe('live Run progress', () => {
  it('streams each step and log line of the Run in progress as it happens, then says the Run has ended', async () => {
    const { holdPipeline, post, openEvents } = startTestDaemon({ now: SUNDAY_10AM });
    const events = await openEvents();
    const held = holdPipeline(4);

    const run = await runNow(post);

    expect(events.contentType).toBe('text/event-stream');
    expect((await events.received()).map(summary)).toEqual([
      'run: none',
      `run: ${run}`,
      `log 0: [Pipeline] Run ${run}`,
      'step 1: Finding story candidates...',
      'log 1: [Pipeline] 1/7 Finding story candidates...',
      'step 2: Choosing and briefing the story...',
      'log 2: [Pipeline] 2/7 Choosing and briefing the story...',
      'step 3: Writing the storyboard...',
      'log 3: [Pipeline] 3/7 Writing the storyboard...',
      'step 4: Synthesizing voiceover...',
      'log 4: [Pipeline] 4/7 Synthesizing voiceover...',
    ]);
    const [, , , step1] = await events.received();
    expect(step1).toEqual({ event: 'step', data: { run, step: 1, message: 'Finding story candidates...' } });

    await held.release();

    expect((await events.received()).slice(11).map(summary)).toEqual([
      'step 5: Generating scene visuals...',
      'log 5: [Pipeline] 5/7 Generating scene visuals...',
      'step 6: Rendering 1080x1920 MP4...',
      'log 6: [Pipeline] 6/7 Rendering 1080x1920 MP4...',
      'step 7: Upload skipped (ENABLE_AUTO_UPLOAD=false or --no-upload). Saved locally.',
      'log 7: [Pipeline] 7/7 Upload skipped (ENABLE_AUTO_UPLOAD=false or --no-upload). Saved locally.',
      'log 8: [Pipeline] Run complete! API spend for this video: $0.00 (≈ ₹0 incl. tax); ' +
        'today: $0.00 (≈ ₹0 incl. tax) of the $0.5 daily budget.',
      'run: none',
    ]);
  });

  it('brings a page that joins part-way through a Run up to date: the Run, its current step, then its log so far', async () => {
    const { clock, holdPipeline, openEvents } = startTestDaemon({ now: SUNDAY_10AM });
    const held = holdPipeline(4);
    await clock.advanceTo(new Date('2026-10-25T18:00'));

    const events = await openEvents();

    const [first] = await events.received();
    const run = (first.data as { run: string }).run;
    expect((await events.received()).map(summary)).toEqual([
      `run: ${run}`,
      'step 4: Synthesizing voiceover...',
      `log 0: [Pipeline] Run ${run}`,
      'log 1: [Pipeline] 1/7 Finding story candidates...',
      'log 2: [Pipeline] 2/7 Choosing and briefing the story...',
      'log 3: [Pipeline] 3/7 Writing the storyboard...',
      'log 4: [Pipeline] 4/7 Synthesizing voiceover...',
    ]);

    await held.release();

    expect((await events.received()).slice(7, 9).map(summary)).toEqual([
      'step 5: Generating scene visuals...',
      'log 5: [Pipeline] 5/7 Generating scene visuals...',
    ]);
  });

  it('follows a command-line Run through its record and its run.log, catching up at each check', async () => {
    const { clock, holdPipeline, startGenerate, openEvents } = startTestDaemon({ now: SUNDAY_10AM });
    const events = await openEvents();
    const held = holdPipeline(4);
    const commandLine = await startGenerate({});

    await clock.advanceTo(new Date('2026-10-25T10:00:05'));

    const run = ((await events.received())[1].data as { run: string }).run;
    expect((await events.received()).map(summary)).toEqual([
      'run: none',
      `run: ${run}`,
      'step 4: Synthesizing voiceover...',
      `log 0: [Pipeline] Run ${run}`,
      'log 1: [Pipeline] 1/7 Finding story candidates...',
      'log 2: [Pipeline] 2/7 Choosing and briefing the story...',
      'log 3: [Pipeline] 3/7 Writing the storyboard...',
      'log 4: [Pipeline] 4/7 Synthesizing voiceover...',
    ]);

    await held.release();
    await commandLine.done;
    await clock.advanceTo(new Date('2026-10-25T10:00:10'));

    expect((await events.received()).slice(8).map(summary)).toEqual([
      'step 7: Upload skipped (ENABLE_AUTO_UPLOAD=false or --no-upload). Saved locally.',
      'log 5: [Pipeline] 5/7 Generating scene visuals...',
      'log 6: [Pipeline] 6/7 Rendering 1080x1920 MP4...',
      'log 7: [Pipeline] 7/7 Upload skipped (ENABLE_AUTO_UPLOAD=false or --no-upload). Saved locally.',
      'log 8: [Pipeline] Run complete! API spend for this video: $0.00 (≈ ₹0 incl. tax); ' +
        'today: $0.00 (≈ ₹0 incl. tax) of the $0.5 daily budget.',
      'run: none',
    ]);
  });

  it("shows the current Run on the front page: its step of 7 with its message, and the tail of its log", async () => {
    const { holdPipeline, post, pageText } = startTestDaemon({ now: SUNDAY_10AM });
    const held = holdPipeline(4);
    const run = await runNow(post);

    expect(await pageText('/')).toContain(
      'Run in progress Started Sun 25 Oct 10:00 by Run now Step 4 of 7: Synthesizing voiceover... ' +
        `[Pipeline] Run ${run} [Pipeline] 1/7 Finding story candidates... [Pipeline] 2/7 Choosing and briefing the story... ` +
        '[Pipeline] 3/7 Writing the storyboard... [Pipeline] 4/7 Synthesizing voiceover... Daemon'
    );

    await held.release();

    expect(await pageText('/')).not.toContain('Run in progress');
  });

  it("shows a Run's step and its log so far on its page while it is in progress, before it has a folder", async () => {
    const { holdPipeline, post, pageText } = startTestDaemon({ now: SUNDAY_10AM });
    holdPipeline(2);

    const run = await runNow(post);

    const page = await pageText(`/runs/${run}`);
    expect(page).toContain('Outcome in progress Step 2 of 7: Choosing and briefing the story...');
    expect(page).toContain(
      `Run log [Pipeline] Run ${run} [Pipeline] 1/7 Finding story candidates... ` +
        '[Pipeline] 2/7 Choosing and briefing the story...'
    );
  });

  it('shows a command-line Run on the front page too, with its step and the tail of its log', async () => {
    const { holdPipeline, startGenerate, pageText } = startTestDaemon({ now: SUNDAY_10AM });
    holdPipeline(4);

    await startGenerate({});

    const page = await pageText('/');
    expect(page).toContain(
      'Run in progress Started Sun 25 Oct 10:00 by the command line Step 4 of 7: Synthesizing voiceover... [Pipeline] Run '
    );
    expect(page).toContain('[Pipeline] 4/7 Synthesizing voiceover... Daemon');
  });

  it('ends open streams when the Daemon stops, so a restart is never held up by an open page', async () => {
    const { openEvents, restart } = startTestDaemon({ now: SUNDAY_10AM });
    const events = await openEvents();

    await restart({});

    expect(await events.ended()).toBe(true);
  });
});
