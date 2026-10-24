import { describe, expect, it, vi } from 'vitest';
import type { AlertCondition } from '../src/daemon/alerts.js';
import { startTestDaemon } from './support/testDaemon.js';

const SUNDAY_10AM = new Date('2026-10-25T10:00');
/** Alerts are pushed only once there is an ntfy topic to push them to. */
const PUSH = { NTFY_TOPIC: 'fvp-alerts-test' };

/** An Alert rule whose conditions the test turns on and off, standing in for any rule. */
function switchableRule() {
  const conditions = new Map<string, AlertCondition>();
  return {
    rule: () => [...conditions.values()],
    on: (condition: AlertCondition) => conditions.set(condition.key, condition),
    off: (key: string) => conditions.delete(key),
  };
}

const LOW_DISK = { key: 'disk-low', text: 'Only 4 GB free on the output drive' };

describe('Alerts', () => {
  it('pushes an Alert once when it starts, and shows it at the top of the front page with its start time', async () => {
    const disk = switchableRule();
    const { clock, calls, pageText } = startTestDaemon({ now: SUNDAY_10AM, env: PUSH, alertRules: [disk.rule] });

    disk.on(LOW_DISK);
    await clock.advanceTo(new Date('2026-10-25T10:30'));

    expect(calls.pushes).toEqual([{ at: SUNDAY_10AM, title: 'Alert', message: 'Only 4 GB free on the output drive' }]);
    const page = await pageText('/');
    expect(page).toContain('Alerts Only 4 GB free on the output drive since Sun 25 Oct 10:00');
    expect(page.indexOf('Only 4 GB free')).toBeLessThan(page.indexOf('Daemon Up'));
  });

  it('pushes "cleared" once when the condition clears, and the Alert leaves the front page', async () => {
    const disk = switchableRule();
    const { clock, calls, pageText } = startTestDaemon({ now: SUNDAY_10AM, env: PUSH, alertRules: [disk.rule] });

    disk.on(LOW_DISK);
    await clock.advanceTo(new Date('2026-10-25T10:05'));
    disk.off(LOW_DISK.key);
    await clock.advanceTo(new Date('2026-10-25T11:00'));

    expect(calls.pushes).toEqual([
      { at: SUNDAY_10AM, title: 'Alert', message: 'Only 4 GB free on the output drive' },
      // Picked up at the next check, a minute after the condition cleared.
      { at: new Date('2026-10-25T10:06'), title: 'Cleared', message: 'Only 4 GB free on the output drive' },
    ]);
    const page = await pageText('/');
    expect(page).not.toContain('Only 4 GB free');
    expect(page).not.toContain('Alerts');
  });

  it('keeps one Alert per key: new text updates it without a push, and another key is another Alert', async () => {
    const rule = switchableRule();
    const { clock, calls, pageText } = startTestDaemon({ now: SUNDAY_10AM, env: PUSH, alertRules: [rule.rule] });

    rule.on(LOW_DISK);
    await clock.advanceTo(new Date('2026-10-25T10:05'));
    rule.on({ key: 'disk-low', text: 'Only 3 GB free on the output drive' });
    rule.on({ key: 'inbox-empty', text: 'The Inbox is empty' });
    await clock.advanceTo(new Date('2026-10-25T10:30'));

    expect(calls.pushes).toEqual([
      { at: SUNDAY_10AM, title: 'Alert', message: 'Only 4 GB free on the output drive' },
      { at: new Date('2026-10-25T10:06'), title: 'Alert', message: 'The Inbox is empty' },
    ]);
    const page = await pageText('/');
    expect(page).toContain('Only 3 GB free on the output drive since Sun 25 Oct 10:00');
    expect(page).toContain('The Inbox is empty since Sun 25 Oct 10:06');
    expect(page).not.toContain('Only 4 GB free');
  });

  it('checks Alert rules as soon as a Run ends, failed or not, without waiting for the next minute', async () => {
    const rule = switchableRule();
    const { generate, calls, failures } = startTestDaemon({ now: SUNDAY_10AM, env: PUSH, alertRules: [rule.rule] });

    // The clock never moves, so only the end of each Run can trigger a check.
    rule.on(LOW_DISK);
    await generate({});
    expect(calls.pushes).toEqual([{ at: SUNDAY_10AM, title: 'Alert', message: 'Only 4 GB free on the output drive' }]);

    rule.on({ key: 'run-failed', text: 'The last Run failed at step 5' });
    failures.pipeline = new Error('Only 3 of 9 shots could be generated');
    await expect(generate({})).rejects.toThrow('Only 3 of 9 shots could be generated');
    expect(calls.pushes.at(-1)).toEqual({ at: SUNDAY_10AM, title: 'Alert', message: 'The last Run failed at step 5' });
  });

  it('logs a failed push and tries it again at the next check, until it goes out once', async () => {
    const disk = switchableRule();
    const { clock, calls, failures } = startTestDaemon({ now: SUNDAY_10AM, env: PUSH, alertRules: [disk.rule] });
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});

    failures.push = 'ntfy.sh answered 502';
    disk.on(LOW_DISK);
    await clock.advanceTo(new Date('2026-10-25T10:01'));

    expect(calls.pushes).toEqual([]);
    expect(warnings).toHaveBeenCalledWith(expect.stringContaining('ntfy.sh answered 502'));

    failures.push = undefined;
    await clock.advanceTo(new Date('2026-10-25T10:30'));

    expect(calls.pushes).toEqual([
      { at: new Date('2026-10-25T10:02'), title: 'Alert', message: 'Only 4 GB free on the output drive' },
    ]);
    warnings.mockRestore();
  });

  it('reminds once a day while an Alert marked to remind stays active, and only that Alert', async () => {
    const rule = switchableRule();
    const { clock, calls } = startTestDaemon({ now: SUNDAY_10AM, env: PUSH, alertRules: [rule.rule] });
    const TOKEN = { key: 'meta-token', text: 'The Meta token expires in 5 days', remind: true };

    rule.on(TOKEN);
    rule.on(LOW_DISK);
    await clock.advanceTo(new Date('2026-10-27T12:00'));
    rule.off(TOKEN.key);
    await clock.advanceTo(new Date('2026-10-29T12:00'));

    expect(calls.pushes).toEqual([
      { at: SUNDAY_10AM, title: 'Alert', message: 'The Meta token expires in 5 days' },
      { at: SUNDAY_10AM, title: 'Alert', message: 'Only 4 GB free on the output drive' },
      {
        at: new Date('2026-10-26T10:00'),
        title: 'Still active',
        message: 'The Meta token expires in 5 days (since Sun 25 Oct 10:00)',
      },
      {
        at: new Date('2026-10-27T10:00'),
        title: 'Still active',
        message: 'The Meta token expires in 5 days (since Sun 25 Oct 10:00)',
      },
      { at: new Date('2026-10-27T12:01'), title: 'Cleared', message: 'The Meta token expires in 5 days' },
    ]);
  });

  it('holds pushes during Quiet hours, then sends everything held, starts and clears alike, as one push', async () => {
    const rule = switchableRule();
    const { clock, calls } = startTestDaemon({
      now: new Date('2026-10-25T22:00'),
      env: PUSH,
      alertRules: [rule.rule],
    });

    // Each change is picked up at the next check, a minute later.
    await clock.advanceTo(new Date('2026-10-25T23:30'));
    rule.on({ key: 'run-failed', text: 'The last Run failed at step 5' });
    await clock.advanceTo(new Date('2026-10-26T01:00'));
    rule.on(LOW_DISK);
    await clock.advanceTo(new Date('2026-10-26T03:00'));
    rule.off(LOW_DISK.key);
    await clock.advanceTo(new Date('2026-10-26T07:59'));

    expect(calls.pushes).toEqual([]);

    await clock.advanceTo(new Date('2026-10-26T12:00'));

    expect(calls.pushes).toEqual([
      {
        at: new Date('2026-10-26T08:00'),
        title: 'Held during Quiet hours',
        message: [
          'Sun 25 Oct 23:31 Alert: The last Run failed at step 5',
          'Mon 26 Oct 01:01 Alert: Only 4 GB free on the output drive',
          'Mon 26 Oct 03:01 Cleared: Only 4 GB free on the output drive',
        ].join('\n'),
      },
    ]);
  });

  it('takes Quiet hours from QUIET_HOURS', async () => {
    const disk = switchableRule();
    const { clock, calls } = startTestDaemon({
      now: SUNDAY_10AM,
      env: { ...PUSH, QUIET_HOURS: '09:30-11:00' },
      alertRules: [disk.rule],
    });

    disk.on(LOW_DISK);
    await clock.advanceTo(new Date('2026-10-25T10:59'));
    expect(calls.pushes).toEqual([]);

    await clock.advanceTo(new Date('2026-10-25T11:30'));
    expect(calls.pushes).toEqual([
      {
        at: new Date('2026-10-25T11:00'),
        title: 'Held during Quiet hours',
        message: 'Sun 25 Oct 10:00 Alert: Only 4 GB free on the output drive',
      },
    ]);
  });

  it('refuses to start with a QUIET_HOURS it cannot read', () => {
    expect(() => startTestDaemon({ now: SUNDAY_10AM, env: { QUIET_HOURS: '11pm to 8am' } })).toThrow(
      'QUIET_HOURS must be a time range like 23:00-08:00, not "11pm to 8am"'
    );
  });

  it('pushes nothing while NTFY_TOPIC is unset, but still shows the Alert', async () => {
    const disk = switchableRule();
    const { clock, calls, pageText } = startTestDaemon({ now: SUNDAY_10AM, alertRules: [disk.rule] });

    disk.on(LOW_DISK);
    await clock.advanceTo(new Date('2026-10-25T10:05'));
    disk.off(LOW_DISK.key);
    await clock.advanceTo(new Date('2026-10-25T10:10'));
    disk.on(LOW_DISK);
    await clock.advanceTo(new Date('2026-10-27T12:00'));

    expect(calls.pushes).toEqual([]);
    expect(await pageText('/')).toContain('Only 4 GB free on the output drive since Sun 25 Oct 10:11');
  });

  it('pushes Alerts still active once a restart sets NTFY_TOPIC, but no "cleared" for one never pushed', async () => {
    const rule = switchableRule();
    const { clock, calls, restart } = startTestDaemon({ now: SUNDAY_10AM, alertRules: [rule.rule] });

    rule.on(LOW_DISK);
    rule.on({ key: 'inbox-empty', text: 'The Inbox is empty' });
    await clock.advanceTo(new Date('2026-10-25T10:05'));
    await restart(PUSH);
    rule.off('inbox-empty');
    await clock.advanceTo(new Date('2026-10-25T10:30'));

    expect(calls.pushes).toEqual([
      { at: new Date('2026-10-25T10:05'), title: 'Alert', message: 'Only 4 GB free on the output drive' },
    ]);
  });

  it("leaves a failing rule's Alerts as they were, logging the failure, while other rules' Alerts still start and clear", async () => {
    const disk = switchableRule();
    const inbox = switchableRule();
    let diskCheckFails = false;
    const diskRule = () => {
      if (diskCheckFails) throw new Error('statfs failed');
      return disk.rule();
    };
    const { clock, calls, pageText } = startTestDaemon({
      now: SUNDAY_10AM,
      env: PUSH,
      alertRules: [diskRule, inbox.rule],
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    disk.on(LOW_DISK);
    await clock.advanceTo(new Date('2026-10-25T10:05'));
    diskCheckFails = true;
    inbox.on({ key: 'inbox-empty', text: 'The Inbox is empty' });
    await clock.advanceTo(new Date('2026-10-25T10:10'));
    inbox.off('inbox-empty');
    await clock.advanceTo(new Date('2026-10-25T10:30'));

    expect(calls.pushes).toEqual([
      { at: SUNDAY_10AM, title: 'Alert', message: 'Only 4 GB free on the output drive' },
      { at: new Date('2026-10-25T10:06'), title: 'Alert', message: 'The Inbox is empty' },
      { at: new Date('2026-10-25T10:11'), title: 'Cleared', message: 'The Inbox is empty' },
    ]);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('statfs failed'));
    expect(await pageText('/')).toContain('Only 4 GB free on the output drive since Sun 25 Oct 10:00');
    errors.mockRestore();
  });
});
