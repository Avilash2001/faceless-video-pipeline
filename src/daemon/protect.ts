import type { MiddlewareHandler } from 'hono';

const READ_METHODS = new Set(['GET', 'HEAD']);

/**
 * Stops other web pages from using the operator's browser against the dashboard. Every request
 * must name a Host in `allowedHosts`, which defeats DNS rebinding. Every action (anything but a
 * read) must also carry an Origin on that same host, so a page elsewhere can't post to it.
 */
export function protect(allowedHosts: string[]): MiddlewareHandler {
  return async (c, next) => {
    const host = (c.req.header('host') ?? new URL(c.req.url).host).toLowerCase();
    if (!allowedHosts.includes(hostname(host))) {
      return c.text(`This dashboard doesn't answer to "${host}". Add it to DASHBOARD_ALLOWED_HOSTS.`, 403);
    }
    if (!READ_METHODS.has(c.req.method) && originHost(c.req.header('origin')) !== host) {
      return c.text('Refused: actions must come from the dashboard itself.', 403);
    }
    await next();
  };
}

/** "localhost:4747" → "localhost". */
function hostname(host: string): string {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return '';
  }
}

/** "http://localhost:4747" → "localhost:4747"; missing or "null" → undefined. */
function originHost(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return undefined;
  }
}
