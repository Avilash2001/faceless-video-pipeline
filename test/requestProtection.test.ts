import { describe, expect, it } from 'vitest';
import { startTestDaemon } from './support/testDaemon.js';

const SUNDAY_10AM = new Date('2026-10-25T10:00');

/** A Daemon with one trivial action, so the protection every action gets can be checked. */
function daemonWithTrivialAction(env?: Record<string, string>) {
  const daemon = startTestDaemon({ now: SUNDAY_10AM, env });
  const ran: string[] = [];
  daemon.app.post('/actions/trivial', (c) => {
    ran.push(c.req.header('host')!);
    return c.text('done');
  });
  return { ...daemon, ran };
}

describe('request protection', () => {
  it('accepts an action posted from the dashboard itself', async () => {
    const { request, ran } = daemonWithTrivialAction();

    const res = await request('/actions/trivial', {
      method: 'POST',
      headers: { host: 'localhost:4747', origin: 'http://localhost:4747' },
    });

    expect(res.status).toBe(200);
    expect(ran).toEqual(['localhost:4747']);
  });

  it('refuses an action posted from another web page', async () => {
    const { request, ran } = daemonWithTrivialAction();

    const res = await request('/actions/trivial', {
      method: 'POST',
      headers: { host: 'localhost:4747', origin: 'https://evil.example' },
    });

    expect(res.status).toBe(403);
    expect(ran).toEqual([]);
  });

  it('refuses an action with no Origin', async () => {
    const { request, ran } = daemonWithTrivialAction();

    const res = await request('/actions/trivial', { method: 'POST', headers: { host: 'localhost:4747' } });

    expect(res.status).toBe(403);
    expect(ran).toEqual([]);
  });

  it('refuses any request for a Host not in DASHBOARD_ALLOWED_HOSTS', async () => {
    const { request, ran } = daemonWithTrivialAction();
    // What a DNS-rebinding page would send: its own name, now pointing at 127.0.0.1.
    const rebound = { host: 'rebind.evil.example:4747', origin: 'http://rebind.evil.example:4747' };

    expect((await request('/', { headers: rebound })).status).toBe(403);
    expect((await request('/actions/trivial', { method: 'POST', headers: rebound })).status).toBe(403);
    expect(ran).toEqual([]);
  });

  it('answers on 127.0.0.1 and on extra hosts listed in DASHBOARD_ALLOWED_HOSTS', async () => {
    const { request, ran } = daemonWithTrivialAction({
      DASHBOARD_ALLOWED_HOSTS: 'localhost,127.0.0.1,studio-pc.tail1234.ts.net',
    });

    expect((await request('/', { headers: { host: '127.0.0.1:4747' } })).status).toBe(200);
    const res = await request('/actions/trivial', {
      method: 'POST',
      headers: { host: 'studio-pc.tail1234.ts.net', origin: 'https://studio-pc.tail1234.ts.net' },
    });

    expect(res.status).toBe(200);
    expect(ran).toEqual(['studio-pc.tail1234.ts.net']);
  });
});
