import type { DatabaseSync } from 'node:sqlite';
import type { RunOptions, Storyboarded } from '../types.js';

/** What started a Run. */
export type RunTrigger = 'slot' | 'run_now' | 'command_line';

/** "Started … by a Slot." */
export const STARTED_BY: Record<RunTrigger, string> = {
  slot: 'a Slot',
  run_now: 'Run now',
  command_line: 'the command line',
};

/** How a Run ended, or that it hasn't yet. A posted outcome comes with Posts. */
export type RunOutcome = 'in_progress' | 'storyboard_only' | 'failed' | 'rendered';

/** Why a failed Run stopped, when it wasn't an error in a step. */
export type FailureReason = 'over budget' | 'interrupted';

/** One Run as recorded. Times are the Daemon's clock. */
export interface RunRecord {
  id: string;
  trigger: RunTrigger;
  options: RunOptions;
  startedAt: Date;
  finishedAt?: Date;
  outcome: RunOutcome;
  /** The step of 7 the Run had reached; for a failed Run, the step it failed at. */
  step?: number;
  error?: string;
  reason?: FailureReason;
  storyExternalId?: string;
  genre?: string;
  title?: string;
  /** The Video's length. */
  durationSec?: number;
  /** The Run's output folder, once it has one. */
  folder?: string;
  videoPath?: string;
  /** The log of a Run that ended before it had a folder to keep run.log in. */
  log?: string;
  /** The spend recorded against the Run. */
  costUsd: number;
}

/** How a Run ended. */
export interface RunEnd {
  outcome: Exclude<RunOutcome, 'in_progress'>;
  at: Date;
  error?: string;
  reason?: FailureReason;
  durationSec?: number;
  videoPath?: string;
  log?: string;
}

interface RunRow {
  id: string;
  trigger: RunTrigger;
  options_json: string;
  started_at: string;
  finished_at: string | null;
  outcome: RunOutcome;
  step: number | null;
  error: string | null;
  reason: FailureReason | null;
  story_external_id: string | null;
  genre: string | null;
  title: string | null;
  duration_sec: number | null;
  folder: string | null;
  video_path: string | null;
  log: string | null;
  cost_usd: number;
}

const SELECT_RUNS = `
  SELECT runs.*, (SELECT COALESCE(SUM(usd), 0) FROM spend_log WHERE run_id = runs.id) AS cost_usd
  FROM runs`;

/**
 * Records a new Run as in progress. Only one Run may be in progress at a time, across every
 * process using the database: while one is, nothing is recorded and that Run is returned.
 */
export function insertRun(
  database: DatabaseSync,
  run: { id: string; trigger: RunTrigger; options: RunOptions; startedAt: Date }
): RunRecord | undefined {
  const insert = database.prepare(
    `INSERT INTO runs (id, trigger, options_json, started_at, outcome, genre)
     VALUES (?, ?, ?, ?, 'in_progress', ?)`
  );
  // A second try covers the Run in the way finishing between the refusal and the lookup.
  for (let attempt = 1; ; attempt++) {
    try {
      insert.run(run.id, run.trigger, JSON.stringify(run.options), run.startedAt.toISOString(), run.options.genre ?? null);
      return undefined;
    } catch (err) {
      const inProgress = runInProgress(database);
      if (inProgress) return inProgress;
      if (attempt === 2) throw err;
    }
  }
}

/** The Run in progress, if any. */
export function runInProgress(database: DatabaseSync): RunRecord | undefined {
  const row = database.prepare(`${SELECT_RUNS} WHERE outcome = 'in_progress'`).get() as RunRow | undefined;
  return row && fromRow(row);
}

/** Notes the step of 7 a Run has started. */
export function recordStep(database: DatabaseSync, id: string, step: number): void {
  database.prepare('UPDATE runs SET step = ? WHERE id = ?').run(step, id);
}

/** Notes the Story a Run is making, its Storyboard's Genre and title, and the folder they are saved in. */
export function recordStoryboard(database: DatabaseSync, id: string, { folder, story, storyboard }: Storyboarded): void {
  database
    .prepare('UPDATE runs SET folder = ?, story_external_id = ?, genre = ?, title = ? WHERE id = ?')
    .run(folder, story.candidate.externalId, storyboard.niche, storyboard.youtubeMetadata.title, id);
}

/** Records how a Run ended. */
export function finishRun(database: DatabaseSync, id: string, end: RunEnd): void {
  database
    .prepare(
      `UPDATE runs SET outcome = ?, finished_at = ?, error = ?, reason = ?, duration_sec = ?, video_path = ?, log = ?
       WHERE id = ?`
    )
    .run(
      end.outcome,
      end.at.toISOString(),
      end.error ?? null,
      end.reason ?? null,
      end.durationSec ?? null,
      end.videoPath ?? null,
      end.log ?? null,
      id
    );
}

/** Marks every Run still in progress as failed (interrupted): no process is running it any more. Returns how many. */
export function interruptRuns(database: DatabaseSync, at: Date): number {
  const { changes } = database
    .prepare(`UPDATE runs SET outcome = 'failed', reason = 'interrupted', finished_at = ? WHERE outcome = 'in_progress'`)
    .run(at.toISOString());
  return Number(changes);
}

/** Runs, newest first; the latest `limit` when given. */
export function listRuns(database: DatabaseSync, limit?: number): RunRecord[] {
  const rows = database
    .prepare(`${SELECT_RUNS} ORDER BY started_at DESC, rowid DESC LIMIT ?`)
    // SQLite reads LIMIT -1 as no limit.
    .all(limit ?? -1) as unknown as RunRow[];
  return rows.map(fromRow);
}

/** One Run, if there is a record of it. */
export function getRun(database: DatabaseSync, id: string): RunRecord | undefined {
  const row = database.prepare(`${SELECT_RUNS} WHERE id = ?`).get(id) as RunRow | undefined;
  return row && fromRow(row);
}

function fromRow(row: RunRow): RunRecord {
  return {
    id: row.id,
    trigger: row.trigger,
    options: JSON.parse(row.options_json),
    startedAt: new Date(row.started_at),
    finishedAt: row.finished_at ? new Date(row.finished_at) : undefined,
    outcome: row.outcome,
    step: row.step ?? undefined,
    error: row.error ?? undefined,
    reason: row.reason ?? undefined,
    storyExternalId: row.story_external_id ?? undefined,
    genre: row.genre ?? undefined,
    title: row.title ?? undefined,
    durationSec: row.duration_sec ?? undefined,
    folder: row.folder ?? undefined,
    videoPath: row.video_path ?? undefined,
    log: row.log ?? undefined,
    costUsd: row.cost_usd,
  };
}
