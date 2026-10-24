import { describe, expect, it, vi } from 'vitest';
import { startTestDaemon } from './support/testDaemon.js';

const SUNDAY_10AM = new Date('2026-10-25T10:00');

describe('schedule', () => {
  it('starts a Run through the Pipeline at each Slot', async () => {
    const { clock, calls } = startTestDaemon({ now: SUNDAY_10AM });

    await clock.advanceTo(new Date('2026-10-27T12:00'));

    expect(calls.pipeline).toEqual([new Date('2026-10-25T18:00'), new Date('2026-10-26T18:00')]);
  });

  it('syncs metrics and evolves on their own schedules', async () => {
    const { clock, calls } = startTestDaemon({ now: SUNDAY_10AM });

    await clock.advanceTo(new Date('2026-10-28T12:00'));

    expect(calls.syncMetrics).toEqual([
      new Date('2026-10-26T02:00'),
      new Date('2026-10-27T02:00'),
      new Date('2026-10-28T02:00'),
    ]);
    expect(calls.evolve).toEqual([]);

    await clock.advanceTo(new Date('2026-11-01T12:00'));

    expect(calls.evolve).toEqual([new Date('2026-11-01T04:00')]);
  });

  it('logs a failed Run and still starts a Run at the next Slot', async () => {
    const { clock, calls, failures } = startTestDaemon({ now: SUNDAY_10AM });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('Gemini is down');

    failures.pipeline = failure;
    await clock.advanceTo(new Date('2026-10-26T12:00'));
    failures.pipeline = undefined;
    await clock.advanceTo(new Date('2026-10-27T12:00'));

    expect(calls.pipeline).toEqual([new Date('2026-10-25T18:00'), new Date('2026-10-26T18:00')]);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('Generate'), failure);
    errors.mockRestore();
  });

  it('skips a Slot the machine slept through instead of running it late', async () => {
    const { clock, calls } = startTestDaemon({ now: SUNDAY_10AM });
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await clock.sleepUntil(new Date('2026-10-25T23:00'));
    await clock.advanceTo(new Date('2026-10-26T19:00'));

    expect(calls.pipeline).toEqual([new Date('2026-10-26T18:00')]);
    warnings.mockRestore();
  });
});
