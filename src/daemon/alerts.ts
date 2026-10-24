import type { DatabaseSync } from 'node:sqlite';
import type { Config } from '../loadConfig.js';
import { inTimeRange } from '../timeRange.js';
import type { Push } from '../types.js';
import type { Adapters } from './index.js';
import { formatLocalTime } from './localTime.js';

const REMIND_EVERY_MS = 24 * 60 * 60_000;

/** A condition an Alert rule reports while it holds. */
export interface AlertCondition {
  /** Stable while the condition lasts: a key seen at the last check is the same Alert. */
  key: string;
  /** What the operator reads on the front page and in pushes. */
  text: string;
  /** Long-running conditions (an expiring token, low disk) remind once a day while active. */
  remind?: boolean;
}

/** Reports the conditions that hold right now; an Alert lasts as long as its rule keeps reporting it. */
export type AlertRule = () => AlertCondition[] | Promise<AlertCondition[]>;

export interface ActiveAlert {
  text: string;
  startedAt: Date;
}

export interface AlertsDeps extends Pick<Adapters, 'clock' | 'notifier'> {
  database: DatabaseSync;
  settings: Config['alerts'];
  rules: AlertRule[];
}

interface AlertRow {
  id: number;
  key: string;
  text: string;
  started_at: string;
}

interface AlertPushes {
  count: number;
  waiting: number;
  lastSent: string | null;
}

interface PushRow {
  id: number;
  title: string;
  message: string;
  at: string;
  held: number;
}

/**
 * The Alert engine. Each check asks every rule what holds now: a condition that wasn't active
 * starts an Alert, and an active Alert whose condition no longer holds clears. Both are pushed,
 * once each; a push that fails waits for the next check. An Alert marked to remind is pushed
 * again a day after its last push, for as long as it stays active. With no ntfy topic nothing is
 * pushed; an Alert still active once one is set is pushed then.
 */
export function createAlerts({ database, clock, notifier, settings, rules }: AlertsDeps) {
  let queue = Promise.resolve();
  /** The rule that last reported each key, so a failing rule holds back only its own clears. */
  const reportedBy = new Map<string, AlertRule>();

  async function runCheck(): Promise<void> {
    const now = clock.now();
    const conditions: AlertCondition[] = [];
    const failed = new Set<AlertRule>();
    for (const rule of rules) {
      try {
        for (const condition of await rule()) {
          conditions.push(condition);
          reportedBy.set(condition.key, rule);
        }
      } catch (err) {
        failed.add(rule);
        console.error(`[Alerts] A rule failed, so its Alerts stay as they are: ${errorText(err)}`);
      }
    }
    /** Whether the rule behind an Alert answered; one no rule has reported since start waits for them all. */
    const answered = (key: string) => {
      const rule = reportedBy.get(key);
      return rule ? !failed.has(rule) : failed.size === 0;
    };

    const active = new Map(activeRows().map((row) => [row.key, row]));
    const holding = new Map(conditions.map((condition) => [condition.key, condition]));
    for (const condition of holding.values()) {
      if (active.has(condition.key)) continue;
      const startedAt = now.toISOString();
      const { lastInsertRowid } = database
        .prepare('INSERT INTO alerts (key, text, started_at) VALUES (?, ?, ?)')
        .run(condition.key, condition.text, startedAt);
      const { key, text } = condition;
      active.set(key, { id: Number(lastInsertRowid), key, text, started_at: startedAt });
    }

    for (const alert of active.values()) {
      const condition = holding.get(alert.key);
      const pushes = pushesFor(alert.id);
      if (!condition) {
        if (!answered(alert.key)) continue;
        database.prepare('UPDATE alerts SET cleared_at = ? WHERE id = ?').run(now.toISOString(), alert.id);
        // An Alert whose start never went out (pushes were off) clears quietly.
        if (pushes.count) enqueue(alert.id, { title: 'Cleared', message: alert.text }, now);
        continue;
      }
      if (condition.text !== alert.text) {
        database.prepare('UPDATE alerts SET text = ? WHERE id = ?').run(condition.text, alert.id);
      }
      if (!pushes.count) {
        // New, or active since before pushes were turned on.
        enqueue(alert.id, { title: 'Alert', message: condition.text }, new Date(alert.started_at));
      } else if (condition.remind && reminderDue(pushes, now)) {
        const since = formatLocalTime(new Date(alert.started_at));
        enqueue(alert.id, { title: 'Still active', message: `${condition.text} (since ${since})` }, now);
      }
    }

    await sendPending(now);
  }

  /** How many pushes an Alert has had, how many are still waiting, and when the last went out. */
  function pushesFor(alertId: number): AlertPushes {
    return database
      .prepare(
        `SELECT COUNT(*) AS count, COUNT(*) - COUNT(sent_at) AS waiting, MAX(sent_at) AS lastSent
         FROM pushes WHERE alert_id = ?`
      )
      .get(alertId) as unknown as AlertPushes;
  }

  /** Keeps a push to send; with no ntfy topic set, there is nowhere to send it. */
  function enqueue(alertId: number, push: Push, at: Date): void {
    if (!settings.ntfyTopic) return;
    database
      .prepare('INSERT INTO pushes (alert_id, title, message, at) VALUES (?, ?, ?, ?)')
      .run(alertId, push.title, push.message, at.toISOString());
  }

  /**
   * Sends every push still waiting, oldest first, stopping at the first that fails. During Quiet
   * hours they are held instead; once those end, everything held goes out as one push.
   */
  async function sendPending(now: Date): Promise<void> {
    if (inTimeRange(now, settings.quietHours)) {
      database.prepare('UPDATE pushes SET held = 1 WHERE sent_at IS NULL').run();
      return;
    }
    const pending = database
      .prepare('SELECT id, title, message, at, held FROM pushes WHERE sent_at IS NULL ORDER BY id')
      .all() as unknown as PushRow[];
    const held = pending.filter((push) => push.held);
    const batches = [
      ...(held.length ? [{ rows: held, push: bundle(held) }] : []),
      ...pending.filter((push) => !push.held).map((row) => ({ rows: [row], push: row })),
    ];
    for (const { rows, push } of batches) {
      try {
        await notifier.send({ title: push.title, message: push.message });
      } catch (err) {
        console.warn(`[Alerts] Push failed; trying again at the next check: ${errorText(err)}`);
        return;
      }
      const sent = database.prepare('UPDATE pushes SET sent_at = ? WHERE id = ?');
      for (const row of rows) sent.run(now.toISOString(), row.id);
    }
  }

  async function checkLogged(): Promise<void> {
    try {
      await runCheck();
    } catch (err) {
      console.error(`[Alerts] Check failed: ${errorText(err)}`);
    }
  }

  function activeRows(): AlertRow[] {
    return database
      .prepare('SELECT id, key, text, started_at FROM alerts WHERE cleared_at IS NULL ORDER BY id')
      .all() as unknown as AlertRow[];
  }

  return {
    /** Checks every rule now, after any check already under way. Never rejects. */
    check(): Promise<void> {
      queue = queue.then(checkLogged);
      return queue;
    },
    /** Active Alerts, oldest first. */
    active(): ActiveAlert[] {
      return activeRows().map((row) => ({ text: row.text, startedAt: new Date(row.started_at) }));
    },
    /** Resolves once no check is under way. */
    idle(): Promise<void> {
      return queue;
    },
  };
}

/** A day since the Alert's last push went out, with none still waiting. */
function reminderDue({ waiting, lastSent }: AlertPushes, now: Date): boolean {
  return !waiting && lastSent !== null && now.getTime() - new Date(lastSent).getTime() >= REMIND_EVERY_MS;
}

function errorText(err: unknown): string {
  return (err as Error)?.message || String(err);
}

/** Pushes held through Quiet hours, as one push listing each with when it happened. */
function bundle(held: PushRow[]): Push {
  return {
    title: 'Held during Quiet hours',
    message: held.map((push) => `${formatLocalTime(new Date(push.at))} ${push.title}: ${push.message}`).join('\n'),
  };
}
