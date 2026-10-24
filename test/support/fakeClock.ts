import type { Clock } from '../../src/daemon/clock.js';

/** A clock that only moves when a test moves it, firing each timer at its own time. */
export class FakeClock implements Clock {
  private time: number;
  private lastId = 0;
  private timers: { id: number; at: number; callback: () => void }[] = [];

  constructor(start: Date) {
    this.time = start.getTime();
  }

  now(): Date {
    return new Date(this.time);
  }

  setTimeout(callback: () => void, ms: number): () => void {
    const id = ++this.lastId;
    this.timers.push({ id, at: this.time + Math.max(0, ms), callback });
    return () => {
      this.timers = this.timers.filter((t) => t.id !== id);
    };
  }

  /** Moves the clock to `time`, firing due timers in order and letting the work they start finish. */
  async advanceTo(time: Date): Promise<void> {
    const target = time.getTime();
    if (target < this.time) throw new Error('FakeClock cannot go backwards');
    for (;;) {
      const next = this.timers
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      this.timers = this.timers.filter((t) => t !== next);
      this.time = Math.max(this.time, next.at);
      next.callback();
      await settle();
    }
    this.time = target;
    await settle();
  }

  /** Moves the clock to `time` as a sleeping machine would: nothing fires until it wakes, then every overdue timer fires at once. */
  async sleepUntil(time: Date): Promise<void> {
    if (time.getTime() < this.time) throw new Error('FakeClock cannot go backwards');
    this.time = time.getTime();
    await this.advanceTo(time);
  }
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
