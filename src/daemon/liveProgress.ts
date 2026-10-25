import type { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { getRun, runInProgress } from '../db/runs.js';

/** What the dashboard's event stream sends: which Run is in progress, a Run's step, or a line of its log. */
export type RunEvent =
  | { event: 'run'; data: { run: string | null } }
  | { event: 'step'; data: { run: string; step: number; message: string } }
  | { event: 'log'; data: { run: string; index: number; line: string } };

/** Where a Run reports what it is doing, as it does it. */
export interface RunWatcher {
  started(id: string): void;
  /** Step `step` of 7 has started. */
  step(id: string, step: number, message: string): void;
  /** A line was written to the Run's log. */
  log(id: string, line: string): void;
  /** The Run has ended, and how is recorded. */
  ended(id: string): void;
}

/** The Run in progress, as far as the dashboard has seen it get. */
export interface LiveRun {
  id: string;
  step?: { step: number; message: string };
  /** The log so far: one entry per line written, which may span several lines. */
  lines: string[];
}

/**
 * The live progress of the Run in progress, for the event stream: reported as it happens by the
 * Runs this Daemon starts, and caught up with by a RunFollower for a Run another process started.
 */
export class LiveProgress implements RunWatcher {
  private live: LiveRun | undefined;
  private readonly subscriptions = new Set<Subscription>();

  /** Run `id`'s progress so far, while it is the one in progress here. */
  of(id: string): LiveRun | undefined {
    return this.live?.id === id ? this.live : undefined;
  }

  /** The events that bring a page up to date with the Run in progress: its step, then its log. */
  catchUp(): RunEvent[] {
    if (!this.live) return [];
    const { id: run, step, lines } = this.live;
    return [
      ...(step ? [{ event: 'step' as const, data: { run, ...step } }] : []),
      ...lines.map((line, index) => ({ event: 'log' as const, data: { run, index, line } })),
    ];
  }

  started(id: string): void {
    this.live = { id, lines: [] };
    this.emit({ event: 'run', data: { run: id } });
  }

  step(id: string, step: number, message: string): void {
    const live = this.of(id);
    if (live) live.step = { step, message };
    this.emit({ event: 'step', data: { run: id, step, message } });
  }

  log(id: string, line: string): void {
    const lines = this.of(id)?.lines;
    lines?.push(line);
    this.emit({ event: 'log', data: { run: id, index: lines ? lines.length - 1 : 0, line } });
  }

  /** Run `id` has ended; another may already have started in its place. */
  ended(id: string): void {
    if (this.of(id)) this.live = undefined;
    this.emit({ event: 'run', data: { run: this.live?.id ?? null } });
  }

  /** Every event from now on, until the subscription, or this, is closed. */
  subscribe(): Subscription {
    const subscription = new Subscription(() => this.subscriptions.delete(subscription));
    this.subscriptions.add(subscription);
    return subscription;
  }

  /** Ends every subscription: for when the Daemon stops, so no stream holds it up. */
  close(): void {
    for (const subscription of this.subscriptions) subscription.close();
  }

  private emit(event: RunEvent): void {
    for (const subscription of this.subscriptions) subscription.push(event);
  }
}

/** Events queued for one listener, taken in order. */
class Subscription {
  private readonly queue: RunEvent[] = [];
  private wake = () => {};
  private closed = false;

  constructor(private readonly onClose: () => void) {}

  push(event: RunEvent): void {
    this.queue.push(event);
    this.wake();
  }

  /** The next event, once there is one; undefined once the subscription is closed. */
  async next(): Promise<RunEvent | undefined> {
    while (this.queue.length === 0 && !this.closed) await new Promise<void>((resolve) => (this.wake = resolve));
    return this.closed ? undefined : this.queue.shift();
  }

  close(): void {
    this.closed = true;
    this.onClose();
    this.wake();
  }
}

/**
 * Follows a Run another process has in progress, such as a command-line Run, which this Daemon only
 * sees through the database: at each check it catches up with the Run's recorded step and the new
 * lines of its run.log, and reports them as this Daemon's own Runs report themselves. Lines written
 * before the Run has a folder reach run.log, and so the dashboard, once it has one.
 */
export class RunFollower {
  private followed: { id: string; step?: number; logBytes: number } | undefined;

  constructor(
    private readonly database: DatabaseSync,
    private readonly live: LiveProgress
  ) {}

  check(): void {
    const inProgress = runInProgress(this.database);
    if (this.followed) {
      this.catchUp(this.followed);
      if (inProgress?.id === this.followed.id) return;
      this.live.ended(this.followed.id);
      this.followed = undefined;
    }
    // A Run this Daemon started reports itself.
    if (inProgress && !this.live.of(inProgress.id)) {
      this.followed = { id: inProgress.id, logBytes: 0 };
      this.live.started(inProgress.id);
      this.catchUp(this.followed);
    }
  }

  private catchUp(followed: NonNullable<RunFollower['followed']>): void {
    const run = getRun(this.database, followed.id);
    if (!run) return;
    if (run.step && run.step !== followed.step) {
      followed.step = run.step;
      this.live.step(run.id, run.step, run.stepMessage ?? '');
    }
    if (!run.folder) return;
    for (const line of newLines(path.join(run.folder, 'run.log'), followed)) this.live.log(run.id, line);
  }
}

/** The whole lines added to `file` since `read.logBytes`, which moves past them. */
function newLines(file: string, read: { logBytes: number }): string[] {
  let added: Buffer;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      added = Buffer.alloc(Math.max(0, fs.fstatSync(fd).size - read.logBytes));
      fs.readSync(fd, added, 0, added.length, read.logBytes);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Not written yet.
    return [];
  }
  // A line still being written waits for the next check.
  const end = added.lastIndexOf('\n') + 1;
  read.logBytes += end;
  return end ? added.subarray(0, end - 1).toString('utf-8').split('\n') : [];
}
