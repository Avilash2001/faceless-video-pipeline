/** Where the Daemon gets the time and waits for it; tests swap in a clock they move by hand. */
export interface Clock {
  now(): Date;
  /** Calls `callback` once, `ms` from now. Returns a function that cancels it. */
  setTimeout(callback: () => void, ms: number): () => void;
}

export const systemClock: Clock = {
  now: () => new Date(),
  setTimeout(callback, ms) {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
};
