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
// just nothing left to do. P3-1 has no scheduler yet, so every job is
// still QUEUED at this point; this already-terminal guard is here for
// when P3-3+ makes RUNNING/ASSIGNED reachable.
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
