import { db } from "../database/db.js";
import type { Job, JobInput } from "./types.js";

const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export function listJobs(): Job[] {
  return db.prepare("SELECT * FROM jobs ORDER BY id DESC").all() as Job[];
}

export function getJob(id: number): Job | undefined {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Job | undefined;
}

export function createJob(input: JobInput): Job {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO jobs (type, status, priority, created_at, progress, input, retry_count)
       VALUES (@type, 'QUEUED', @priority, @created_at, 0, @input, 0)`,
    )
    .run({ ...input, created_at: new Date().toISOString() });
  return getJob(Number(lastInsertRowid))!;
}

// No-op if the job is already in a terminal state (COMPLETED/FAILED/
// already CANCELLED) — cancelling a finished job isn't an error, it's
// just nothing left to do.
export function cancelJob(id: number): Job | undefined {
  const job = getJob(id);
  if (!job) return undefined;
  if (TERMINAL_STATUSES.has(job.status)) return job;

  db.prepare(`UPDATE jobs SET status = 'CANCELLED', finished_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    id,
  );
  return getJob(id);
}

// P3-4: the oldest ASSIGNED-but-not-yet-delivered job for this worker.
// One at a time, even if the worker has multiple GPU slots and could in
// principle have several ASSIGNED jobs simultaneously — the Agent only
// runs one job at a time for now (see agent's TestJobRunner). A worker
// with 2 free GPU slots will have its 2nd assigned job just sit ASSIGNED
// until the 1st completes and this is called again next heartbeat. True
// concurrent multi-slot execution is a later polish item, not P3-4's
// "prove the loop works" scope.
export function getAssignedJobForWorker(workerId: number): Job | undefined {
  return db
    .prepare(`SELECT * FROM jobs WHERE worker_id = ? AND status = 'ASSIGNED' ORDER BY id ASC LIMIT 1`)
    .get(workerId) as Job | undefined;
}

export function startJob(id: number): void {
  db.prepare(`UPDATE jobs SET status = 'RUNNING', started_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
}

// Scoped by workerId — same reasoning as completeJob below. Only while
// RUNNING — a stray/late progress update for a job that's already
// COMPLETED/FAILED/CANCELLED (e.g. a delayed request) must not
// resurrect its displayed progress.
export function updateJobProgress(id: number, workerId: number, progress: number): void {
  db.prepare(`UPDATE jobs SET progress = ? WHERE id = ? AND worker_id = ? AND status = 'RUNNING'`).run(
    progress,
    id,
    workerId,
  );
}

// Scoped by workerId (the authenticated agent's own workstation, from
// its agent credential — see requireAgentAuth) so one Agent can never
// complete/fail a job assigned to a different workstation, same
// principle as commands.ts's recordCommandResult.
export function completeJob(
  id: number,
  workerId: number,
  ok: boolean,
  output: string | null,
  error: string | null,
): Job | undefined {
  // Progress only forced to 100 on success — a job that FAILED partway
  // through keeps whatever progress it had reached (better-sqlite3 also
  // rejects `undefined` as a bound parameter, so this can't be a single
  // statement with a conditional progress value).
  if (ok) {
    db.prepare(
      `UPDATE jobs SET status = 'COMPLETED', finished_at = ?, progress = 100, output = ?, error = ?
         WHERE id = ? AND worker_id = ? AND status = 'RUNNING'`,
    ).run(new Date().toISOString(), output, error, id, workerId);
  } else {
    db.prepare(
      `UPDATE jobs SET status = 'FAILED', finished_at = ?, output = ?, error = ?
         WHERE id = ? AND worker_id = ? AND status = 'RUNNING'`,
    ).run(new Date().toISOString(), output, error, id, workerId);
  }
  return getJob(id);
}
