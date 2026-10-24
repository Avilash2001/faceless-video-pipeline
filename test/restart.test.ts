import { describe, expect, it } from 'vitest';
import { startTestDaemon } from './support/testDaemon.js';

const SUNDAY_10AM = new Date('2026-10-25T10:00');
const A_SECOND_LATER = new Date('2026-10-25T10:00:01');

/** The page's Restart form, from its opening tag to its button's closing tag. */
function restartForm(page: string): string | undefined {
  return page.match(/<form[^>]*>\s*<button[^>]*>Restart<\/button>/)?.[0];
}

describe('Restart', () => {
  it('under pm2, the front page has a Restart button that posts the restart', async () => {
    const { request } = startTestDaemon({ now: SUNDAY_10AM, underPm2: true });

    const form = restartForm(await (await request('/')).text());

    expect(form).toMatch(/method="post"/);
    expect(form).toMatch(/action="\/actions\/restart"/);
    expect(form).not.toMatch(/disabled/);
  });

  it("when pm2 isn't running the daemon, the Restart button is disabled and the page says why", async () => {
    const { request, pageText } = startTestDaemon({ now: SUNDAY_10AM, underPm2: false });

    expect(restartForm(await (await request('/')).text())).toMatch(/<button[^>]*disabled[^>]*>Restart</);
    expect(await pageText('/')).toContain(
      "Restart is off: pm2 isn't running the daemon, so nothing would start it again."
    );
  });

  it('under pm2, answers that it is restarting, then asks Process control to restart', async () => {
    const { clock, calls, post } = startTestDaemon({ now: SUNDAY_10AM, underPm2: true });

    const res = await post('/actions/restart');

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Restarting');
    await clock.advanceTo(A_SECOND_LATER);
    expect(calls.restarts).toEqual([SUNDAY_10AM]);
  });

  it('stops the schedule and the heartbeat before exiting, so nothing runs while pm2 restarts it', async () => {
    const HEALTHCHECK_URL = 'https://hc-ping.example/5f1c-test';
    const { clock, calls, post } = startTestDaemon({ now: SUNDAY_10AM, env: { HEALTHCHECK_URL }, underPm2: true });
    await clock.advanceTo(A_SECOND_LATER);

    await post('/actions/restart');
    await clock.advanceTo(new Date('2026-10-25T19:00'));

    expect(calls.restarts).toHaveLength(1);
    expect(calls.pipeline).toEqual([]);
    expect(calls.heartbeat.map(({ at }) => at)).toEqual([SUNDAY_10AM]);
  });

  it("when pm2 isn't running the daemon, refuses and says why, since nothing would start it again", async () => {
    const { clock, calls, post } = startTestDaemon({ now: SUNDAY_10AM, underPm2: false });

    const res = await post('/actions/restart');
    await clock.advanceTo(A_SECOND_LATER);

    expect(res.status).toBe(409);
    expect(await res.text()).toContain("pm2 isn't running the daemon");
    expect(calls.restarts).toEqual([]);
  });
});
