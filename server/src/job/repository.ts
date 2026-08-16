import { db } from "../database/db.js";
import { isAgentOnline } from "../agent/onlineStatus.js";
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
      `INSERT INTO jobs (type, status, priority, created_at, progress, input, retry_count, depends_on, required_software)
       VALUES (@type, 'QUEUED', @priority, @created_at, 0, @input, 0, @depends_on, @required_software)`,
    )
    .run({
      ...input,
      created_at: new Date().toISOString(),
      // better-sqlite3 only binds string/number/null/buffer — the
      // object form is JobInput's caller-facing shape, not the wire
      // format `jobs.required_software` (see types.ts) actually stores.
      required_software: input.required_software === null ? null : JSON.stringify(input.required_software),
    });
  return getJob(Number(lastInsertRowid))!;
}

// P3-6: true if this job has no dependency, or its dependency is
// COMPLETED. A job whose dependency FAILED/CANCELLED stays blocked
// forever rather than silently running out of order — that's a
// judgment call for a human (retry the dependency, or cancel this one),
// not something the scheduler should guess at.
export function isDependencySatisfied(job: Job): boolean {
  if (job.depends_on === null) return true;
  const dependency = getJob(job.depends_on);
  return dependency?.status === "COMPLETED";
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
// P4-2: fps/eta_seconds are optional (only FFmpeg-style jobs report
// them so far) -- null just leaves the existing stored value alone
// rather than overwriting it, so a job type that never reports them
// doesn't flicker a real value back to null on its next plain progress
// update.
export function updateJobProgress(
  id: number,
  workerId: number,
  progress: number,
  fps: number | null = null,
  etaSeconds: number | null = null,
): void {
  db.prepare(
    `UPDATE jobs SET progress = ?, fps = COALESCE(?, fps), eta_seconds = COALESCE(?, eta_seconds)
       WHERE id = ? AND worker_id = ? AND status = 'RUNNING'`,
  ).run(progress, fps, etaSeconds, id, workerId);
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

// P3-5: whether the job is still RUNNING and still owned by this
// worker. Called on every heartbeat that reports progress for a job —
// if it's gone false (someone cancelled it via POST /api/jobs/:id/cancel
// while it was running), the server tells the Agent to stop rather than
// silently ignoring progress updates for a job the Agent doesn't know
// was cancelled out from under it.
export function isJobStillRunning(id: number, workerId: number): boolean {
  const job = getJob(id);
  return job?.status === "RUNNING" && job.worker_id === workerId;
}

// P3-5: only valid from FAILED — retrying a job that's still QUEUED/
// RUNNING/ASSIGNED makes no sense (nothing to retry yet), and retrying
// a COMPLETED/CANCELLED one would silently resurrect it. Re-queues with
// a bumped retry_count and cleared result fields; the scheduler picks
// it up like any other QUEUED job. No hard-coded max attempts yet —
// each retry is a deliberate admin action, not automatic.
export function retryJob(id: number): Job | undefined {
  const job = getJob(id);
  if (!job) return undefined;
  if (job.status !== "FAILED") return job;

  db.prepare(
    `UPDATE jobs
       SET status = 'QUEUED', retry_count = retry_count + 1, progress = 0, fps = NULL, eta_seconds = NULL,
           worker_id = NULL, gpu_slot = NULL, started_at = NULL, finished_at = NULL, error = NULL
       WHERE id = ?`,
  ).run(id);
  return getJob(id);
}

// P3-5: a job whose worker went offline (Agent crashed, machine lost
// power, network dropped) mid-run would otherwise sit RUNNING forever —
// nothing would ever mark it done, and the scheduler would think that
// GPU slot / CPU unit is still busy indefinitely. Called from
// runScheduler() on every tick: any RUNNING job whose worker isn't
// agentOnline gets marked FAILED with an explanatory error, freeing its
// slot for the next assignment.
export function failStaleRunningJobs(): void {
  const running = db
    .prepare(
      `SELECT jobs.id as job_id, workstations.last_seen as last_seen
         FROM jobs JOIN workstations ON workstations.id = jobs.worker_id
         WHERE jobs.status = 'RUNNING'`,
    )
    .all() as Array<{ job_id: number; last_seen: string | null }>;

  for (const row of running) {
    if (!isAgentOnline(row.last_seen)) {
      db.prepare(
        `UPDATE jobs SET status = 'FAILED', finished_at = ?, error = 'Worker went offline while job was running'
           WHERE id = ?`,
      ).run(new Date().toISOString(), row.job_id);
    }
  }
}
