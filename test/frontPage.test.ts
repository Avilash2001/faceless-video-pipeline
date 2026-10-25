import { describe, expect, it } from 'vitest';
import { startTestDaemon } from './support/testDaemon.js';

// Tests run in Asia/Kolkata (UTC+05:30, see vitest.config.ts), so these times are local, not UTC.
const SUNDAY_10AM = new Date('2026-10-25T10:00');

describe('front page', () => {
  it('shows the daemon is up', async () => {
    const { pageText } = startTestDaemon({ now: SUNDAY_10AM });

    expect(await pageText('/')).toContain('Daemon Up');
  });

  it('shows when the next Slot is due, in local time, moving on once it has passed', async () => {
    const { clock, pageText } = startTestDaemon({ now: SUNDAY_10AM });

    expect(await pageText('/')).toContain('Generate Sun 25 Oct 18:00');

    await clock.advanceTo(new Date('2026-10-25T19:00'));

    expect(await pageText('/')).toContain('Generate Mon 26 Oct 18:00');
  });

  it('shows the next metrics sync and evolve times from the configured schedules', async () => {
    const { pageText } = startTestDaemon({
      now: SUNDAY_10AM,
      env: { CRON_METRICS_SCHEDULE: '30 3 * * *', CRON_EVOLVE_SCHEDULE: '0 4 * * 3' },
    });

    const page = await pageText('/');
    expect(page).toContain('Metrics sync Mon 26 Oct 03:30');
    expect(page).toContain('Evolve Wed 28 Oct 04:00');
  });

  it('shows the 5 most recent Runs, newest first, with their outcome, Genre, title, length and cost', async () => {
    const { clock, generate, pipelineSpend, pageText } = startTestDaemon({ now: SUNDAY_10AM });
    pipelineSpend.push(0, 0, 0, 0, 0.12);

    for (let minute = 1; minute <= 5; minute++) {
      await generate({});
      await clock.advanceTo(new Date(`2026-10-25T10:0${minute}`));
    }
    await generate({ storyboardOnly: true });

    const page = await pageText('/');
    expect(page).toContain(
      'Recent Runs ' +
        'Sun 25 Oct 10:05 storyboard only true_heists_cons · They beat the vault · $0.00 ' +
        'Sun 25 Oct 10:04 rendered true_heists_cons · They beat the vault · 42 s · $0.12 ' +
        'Sun 25 Oct 10:03 rendered'
    );
    expect(page).toContain('Sun 25 Oct 10:01 rendered true_heists_cons · They beat the vault · 42 s · $0.00 All Runs');
    expect(page).not.toContain('Sun 25 Oct 10:00 rendered');
  });
});
