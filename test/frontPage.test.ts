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
});
