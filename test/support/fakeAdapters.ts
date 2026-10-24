import type { Adapters } from '../../src/daemon/index.js';
import type { FakeClock } from './fakeClock.js';

/** Adapters that record when each was called instead of leaving the process. */
export function fakeAdapters(clock: FakeClock) {
  const calls = {
    pipeline: [] as Date[],
    syncMetrics: [] as Date[],
    evolve: [] as Date[],
  };
  /** Set one to make that adapter throw it until it is cleared. */
  const failures: { pipeline?: Error } = {};
  const adapters: Adapters = {
    clock,
    pipeline: {
      run: async () => {
        calls.pipeline.push(clock.now());
        if (failures.pipeline) throw failures.pipeline;
      },
    },
    analytics: {
      syncMetrics: async () => {
        calls.syncMetrics.push(clock.now());
      },
      evolve: async () => {
        calls.evolve.push(clock.now());
      },
    },
  };
  return { adapters, calls, failures };
}
