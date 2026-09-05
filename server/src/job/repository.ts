import { db } from "../database/db.js";
import { isAgentOnline } from "../agent/onlineStatus.js";
import type { Job, JobInput } from "./types.js";
import { ConflictError, NotFoundError } from "../workstation/errors.js";

const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

function uploadProject(job: Job): string | null {
  try { const p = JSON.parse(job.input ?? "null")?.projectId; return typeof p === "string" && /^upload-[0-9a-f-]{36}$/.test(p) ? p : null; }
  catch { return null; }
}
function retainCleanup(job: Job) {
  const project = uploadProject(job);
  if (project) db.prepare(`INSERT INTO job_file_cleanup(job_id, project_id, status) VALUES (?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET status = excluded.status`).run(job.id, project, job.status);
}
export function jobCleanup(id: number, projectId: string, claim = false) {
  return db.transaction(() => {
    const live = getJob(id);
    const archived = db.prepare("SELECT * FROM job_file_cleanup WHERE job_id = ?").get(id) as { project_id: string; status: string } | undefined;
    const project = live ? uploadProject(live) : archived?.project_id;
    if (!project || project !== projectId) throw new NotFoundError("Cleanup history unavailable");
    const status = live?.status ?? archived!.status;
    const allowed = ["COMPLETED", "FAILED"].includes(status);
    if (claim) {
      if (!allowed) throw new ConflictError("Job may still be using its files");
      if (live) retainCleanup(live);
      db.prepare("UPDATE job_file_cleanup SET claimed = 1 WHERE job_id = ?").run(id);
    }
    return { id, status, allowed, archived: !live };
  })();
}

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

export type DeleteJobResult = "deleted" | "not_found" | "still_active";

// Permanent removal (unlike cancelJob, which just changes status) --
// only allowed once a job is terminal (COMPLETED/FAILED/CANCELLED), same
// set cancelJob already uses. Refusing to delete a QUEUED/ASSIGNED/
// RUNNING job isn't just tidiness: the scheduler's busy-tracking
// (job/scheduler.ts) and an Agent's in-flight IJobRunner both key off
// jobs.id, and a job that vanishes out from under either mid-run would
// surface as a confusing "job not found" on the next progress/result
// report rather than a clean state transition -- cancel it first, then
// delete. `jobs.depends_on` has a real foreign key
// (`REFERENCES jobs(id)`, enforced -- db.ts turns PRAGMA foreign_keys
// on) with no ON DELETE clause, so deleting a job another job still
// depends on throws SqliteError (FOREIGN KEY constraint failed) rather
// than silently orphaning the reference -- left uncaught here
// deliberately so that failure reaches the API route as a real error,
// not a silent no-op.
export function deleteJob(id: number): DeleteJobResult {
  const job = getJob(id);
  if (!job) return "not_found";
  if (!TERMINAL_STATUSES.has(job.status)) return "still_active";

  db.transaction(() => { retainCleanup(job); db.prepare(`DELETE FROM jobs WHERE id = ?`).run(id); })();
  return "deleted";
}

// Bulk "clear history" -- every terminal job at once, atomically (one
// transaction: all deleted or none, never a half-cleared table). Only
// ever touches terminal jobs, same rule as the single-job deleteJob
// above -- a QUEUED/ASSIGNED/RUNNING job is simply left alone, not an
// error. Deletes in descending id order: `jobs.depends_on` can only
// reference an id that already existed when the dependent job was
// created (enforced in api/jobs.ts's POST handler), so a dependency
// always points to a *lower* id -- deleting highest-id-first guarantees
// a dependent job is always gone before whatever it depended on, so two
// terminal jobs in a dependency chain never hit the foreign key
// constraint against each other. The one case this does NOT protect
// against -- a terminal job that a still-*active* (non-terminal, so not
// part of this batch) job depends on -- deliberately throws
// (SqliteError, FOREIGN KEY constraint failed) and rolls back the whole
// batch rather than silently deleting everything else around it; rare
// enough in practice (job dependencies are barely used) that surfacing
// it as a real error for a human to resolve beats a partial, silently
// inconsistent clear.
export function deleteTerminalJobs(): number {
  const terminal = db
    .prepare(`SELECT id FROM jobs WHERE status IN ('COMPLETED', 'FAILED', 'CANCELLED') ORDER BY id DESC`)
    .all() as Array<{ id: number }>;
  if (terminal.length === 0) return 0;

  const del = db.prepare(`DELETE FROM jobs WHERE id = ?`);
  const deleteAll = db.transaction((ids: number[]) => {
    for (const id of ids) { retainCleanup(getJob(id)!); del.run(id); }
  });
  deleteAll(terminal.map((row) => row.id));
  return terminal.length;
}

// P4-3H: every ASSIGNED-but-not-yet-delivered job for this worker, oldest
// first — one per free GPU slot the scheduler already reserved
// independently (job/scheduler.ts's workerUnits/findAssignment). Used to
// be single/LIMIT 1 (P3-4: "the Agent only runs one job at a time") —
// true concurrent multi-slot execution is now implemented on the Agent
// side (one IJobRunner-tracked execution per job id, not a single global
// slot), so the server hands out everything it has for this worker and
// lets the Agent start as many as it has capacity for. An Agent that
// hasn't been redeployed yet just starts the first and leaves the rest
// ASSIGNED until a later heartbeat, same as before — see Worker.cs.
export function getAssignedJobsForWorker(workerId: number): Job[] {
  return db
    .prepare(`SELECT * FROM jobs WHERE worker_id = ? AND status = 'ASSIGNED' ORDER BY id ASC`)
    .all(workerId) as Job[];
}

export function startJob(id: number): void {
  const now = new Date().toISOString();
  // last_progress_at seeded to "now" here too, not just on the first real
  // progress update — a job that's just about to start shouldn't already
  // read as stale on the very next scheduler tick before its first
  // heartbeat comes in.
  db.prepare(`UPDATE jobs SET status = 'RUNNING', started_at = ?, last_progress_at = ? WHERE id = ?`).run(
    now,
    now,
    id,
  );
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
    `UPDATE jobs SET progress = ?, fps = COALESCE(?, fps), eta_seconds = COALESCE(?, eta_seconds), last_progress_at = ?
       WHERE id = ? AND worker_id = ? AND status = 'RUNNING'`,
  ).run(progress, fps, etaSeconds, new Date().toISOString(), id, workerId);
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
  if (db.prepare("SELECT 1 FROM job_file_cleanup WHERE job_id = ? AND claimed = 1").get(id)) {
    throw new ConflictError("Upload files have been released for cleanup; upload the source again");
  }

  db.prepare(
    `UPDATE jobs
       SET status = 'QUEUED', retry_count = retry_count + 1, progress = 0, fps = NULL, eta_seconds = NULL,
           worker_id = NULL, gpu_slot = NULL, started_at = NULL, finished_at = NULL, error = NULL
       WHERE id = ?`,
  ).run(id);
  return getJob(id);
}

// P4-3H: a RUNNING job's own execution lease, independent of the
// worker's heartbeat freshness (AGENT_OFFLINE_THRESHOLD_MS in
// onlineStatus.ts, 20s). 30s is 6x the default 5s heartbeat interval —
// generous slack for one or two missed/slow ticks before treating the
// job as orphaned. This is what actually catches the bug this milestone
// was written for: an Agent process that restarts mid-job keeps
// heartbeating normally (worker stays "online") but has no memory of the
// job it was running, so that job's last_progress_at simply stops moving
// forever — the old worker-offline-only check could never see that.
const JOB_LEASE_THRESHOLD_MS = 30_000;

// P3-5/P4-3H: a RUNNING job stops being trustworthy in two independent
// ways — (a) its *worker* goes offline entirely (Agent crashed, machine
// lost power, network dropped), or (b) the worker is still online and
// heartbeating, but this *specific job's* execution lease expired
// because the Agent-side runner tracking it is gone (most commonly: the
// Agent process itself restarted mid-job — see job #35's 2026-09-02
// incident in docs/PROJECT_STATUS.md). Either way the job would
// otherwise sit RUNNING forever, and the scheduler would think that GPU
// slot / CPU unit is still busy indefinitely. Called from runScheduler()
// on every tick.
export function failStaleRunningJobs(): void {
  const running = db
    .prepare(
      `SELECT jobs.id as job_id, jobs.last_progress_at as last_progress_at, workstations.last_seen as last_seen
         FROM jobs JOIN workstations ON workstations.id = jobs.worker_id
         WHERE jobs.status = 'RUNNING'`,
    )
    .all() as Array<{ job_id: number; last_progress_at: string | null; last_seen: string | null }>;

  const now = Date.now();
  for (const row of running) {
    const workerOffline = !isAgentOnline(row.last_seen);
    const leaseExpired =
      !row.last_progress_at || now - new Date(row.last_progress_at).getTime() > JOB_LEASE_THRESHOLD_MS;
    if (!workerOffline && !leaseExpired) continue;

    const error = workerOffline
      ? "Worker went offline while job was running"
      : `STALE_EXECUTION: no progress reported for this job in over ${JOB_LEASE_THRESHOLD_MS / 1000}s even though the worker is still online — its Agent-side execution was lost (e.g. Agent process restarted mid-job)`;
    db.prepare(`UPDATE jobs SET status = 'FAILED', finished_at = ?, error = ? WHERE id = ?`).run(
      new Date().toISOString(),
      error,
      row.job_id,
    );
  }
}
