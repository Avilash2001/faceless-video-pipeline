import { describe, expect, it } from 'vitest';
import { startTestDaemon } from './support/testDaemon.js';

const SUNDAY_10AM = new Date('2026-10-25T10:00');

/** A slice of .env.example: settings it fills in, and optional ones it leaves empty. */
const ENV_EXAMPLE = `# Gemini
GEMINI_API_KEY=your_gemini_api_key_here
PEXELS_API_KEY=
QUIET_HOURS=23:00-08:00
NTFY_TOPIC=
HEALTHCHECK_URL=
`;

describe('the missing .env keys Alert', () => {
  it('lists keys .env lacks, or leaves empty where .env.example fills them in, and clears once they are filled in', async () => {
    const env = { NTFY_TOPIC: 'fvp-alerts-test', GEMINI_API_KEY: '', PEXELS_API_KEY: '' };
    const { clock, calls, pageText, writeEnv } = startTestDaemon({ now: SUNDAY_10AM, env, envExample: ENV_EXAMPLE });

    await clock.advanceTo(new Date('2026-10-25T10:05'));

    const missing = 'Keys missing or empty in .env: GEMINI_API_KEY, QUIET_HOURS, HEALTHCHECK_URL';
    expect(calls.pushes).toEqual([{ at: SUNDAY_10AM, title: 'Alert', message: missing }]);
    expect(await pageText('/')).toContain(`${missing} since Sun 25 Oct 10:00`);

    writeEnv({ ...env, GEMINI_API_KEY: 'AIza-test-key' });
    await clock.advanceTo(new Date('2026-10-25T10:10'));

    expect(await pageText('/')).toContain('Keys missing or empty in .env: QUIET_HOURS, HEALTHCHECK_URL since Sun 25 Oct 10:00');
    expect(calls.pushes).toHaveLength(1);

    writeEnv({ ...env, GEMINI_API_KEY: 'AIza-test-key', QUIET_HOURS: '23:00-08:00', HEALTHCHECK_URL: '' });
    await clock.advanceTo(new Date('2026-10-25T10:30'));

    expect(calls.pushes.at(-1)).toEqual({
      at: new Date('2026-10-25T10:11'),
      title: 'Cleared',
      message: 'Keys missing or empty in .env: QUIET_HOURS, HEALTHCHECK_URL',
    });
    expect(calls.pushes).toHaveLength(2);
    expect(await pageText('/')).not.toContain('Keys missing');
  });
});
