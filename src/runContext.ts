import { AsyncLocalStorage } from 'node:async_hooks';
import { format } from 'node:util';

/** Where work done during a Run reports to, however deep in the pipeline it happens. */
export interface RunContext {
  /** Takes each line printed to the console during the Run. */
  log(line: string): void;
  /** Records spend against the Run. */
  spend(item: string, usd: number): void;
}

const current = new AsyncLocalStorage<RunContext>();

/** The Run the calling code is part of, if any. */
export function currentRun(): RunContext | undefined {
  return current.getStore();
}

/** Does `work` as part of a Run, so its console output and spend reach `run`. */
export function withinRun<T>(run: RunContext, work: () => Promise<T>): Promise<T> {
  teeConsole();
  return current.run(run, work);
}

let teed = false;

/** From the first Run on, console output made during a Run is also copied to that Run's log. */
function teeConsole(): void {
  if (teed) return;
  teed = true;
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    const print = console[method];
    console[method] = (...args: unknown[]) => {
      current.getStore()?.log(format(...args));
      print.apply(console, args);
    };
  }
}
