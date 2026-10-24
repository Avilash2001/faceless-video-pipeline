import { Cron } from 'croner';
import type { Clock } from './clock.js';

export interface ScheduledTask {
  /** Shown on the front page and in logs. */
  name: string;
  /** A cron expression, in the machine's local time. */
  expression: string;
  run(): Promise<void>;
}

/** Longest the schedule sleeps between checks, so a sleeping machine or a clock change can't throw it far off. */
const MAX_WAIT_MS = 60_000;
/** A due time found this late (the machine slept, or the process stalled) is skipped, not run late. */
const MISSED_AFTER_MS = 5 * 60_000;

/** The first time after `after` that a cron expression comes due, in the machine's local time. */
export function nextDue(expression: string, after: Date): Date {
  const next = new Cron(expression).nextRun(after);
  if (!next) throw new Error(`Schedule "${expression}" never comes due again`);
  return next;
}

/**
 * Runs each task whenever its expression comes due by `clock`. A task that is due again while
 * it is still running starts again; a due time slept through is skipped, never made up.
 * Returns a function that stops the schedule.
 */
export function startSchedule(clock: Clock, tasks: ScheduledTask[]): () => void {
  const due = tasks.map((task) => nextDue(task.expression, clock.now()));
  let cancel = () => {};

  const arm = () => {
    const soonest = Math.min(...due.map((d) => d.getTime()));
    cancel = clock.setTimeout(check, Math.min(Math.max(0, soonest - clock.now().getTime()), MAX_WAIT_MS));
  };

  const check = () => {
    const now = clock.now();
    tasks.forEach((task, i) => {
      if (now < due[i]) return;
      const missed = now.getTime() - due[i].getTime() > MISSED_AFTER_MS;
      if (missed) console.warn(`[Daemon] Skipped ${task.name} due at ${due[i].toLocaleString()}: the machine was asleep or busy.`);
      else runLogged(task);
      due[i] = nextDue(task.expression, now);
    });
    arm();
  };

  arm();
  return () => cancel();
}

async function runLogged(task: ScheduledTask): Promise<void> {
  try {
    await task.run();
  } catch (err) {
    console.error(`[Daemon ${task.name} Error]:`, err);
  }
}
