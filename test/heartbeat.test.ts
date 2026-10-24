import { describe, expect, it, vi } from 'vitest';
import { startTestDaemon } from './support/testDaemon.js';

const SUNDAY_10AM = new Date('2026-10-25T10:00');
const HEALTHCHECK_URL = 'https://hc-ping.example/5f1c-test';

/** Local times on Sunday 25 October, one every 5 minutes from `from`. */
function every5Minutes(from: string, count: number): Date[] {
  const start = new Date(`2026-10-25T${from}`).getTime();
  return Array.from({ length: count }, (_, i) => new Date(start + i * 5 * 60_000));
}

describe('heartbeat', () => {
  it('pings HEALTHCHECK_URL as the daemon starts and every 5 minutes after', async () => {
    const { clock, calls } = startTestDaemon({ now: SUNDAY_10AM, env: { HEALTHCHECK_URL } });

    await clock.advanceTo(new Date('2026-10-25T10:22'));

    expect(calls.heartbeat).toEqual(every5Minutes('10:00', 5).map((at) => ({ at, url: HEALTHCHECK_URL })));
  });

  it('never pings when HEALTHCHECK_URL is unset', async () => {
    const { clock, calls } = startTestDaemon({ now: SUNDAY_10AM });

    await clock.advanceTo(new Date('2026-10-26T10:00'));

    expect(calls.heartbeat).toEqual([]);
  });

  it('logs a failed ping and keeps pinging', async () => {
    const { clock, calls, failures } = startTestDaemon({ now: SUNDAY_10AM, env: { HEALTHCHECK_URL } });
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});

    failures.heartbeat = 'getaddrinfo ENOTFOUND hc-ping.example';
    await clock.advanceTo(new Date('2026-10-25T10:07'));
    failures.heartbeat = undefined;
    await clock.advanceTo(new Date('2026-10-25T10:12'));

    expect(warnings).toHaveBeenCalledWith(expect.stringContaining('getaddrinfo ENOTFOUND hc-ping.example'));
    expect(calls.heartbeat.map(({ at }) => at)).toEqual(every5Minutes('10:10', 1));
    warnings.mockRestore();
  });
});
