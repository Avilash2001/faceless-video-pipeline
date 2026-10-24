/** Where the Daemon gets the time and waits for it; tests swap in a clock they move by hand. */
export interface Clock {
  now(): Date;
  /** Calls `callback` once, `ms` from now. Returns a function that cancels it. */
  setTimeout(callback: () => void, ms: number): () => void;
}

/** Calls `callback` on the clock's next turn, then every `ms` after. Returns a function that stops it. */
export function every(clock: Clock, ms: number, callback: () => void): () => void {
  const tick = () => {
    cancel = clock.setTimeout(tick, ms);
    callback();
  };
  let cancel = clock.setTimeout(tick, 0);
  return () => cancel();
}

export const systemClock: Clock = {
  now: () => new Date(),
  setTimeout(callback, ms) {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
};
