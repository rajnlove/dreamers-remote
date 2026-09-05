import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../database/db.js";
import {
  completeJob,
  createJob,
  deleteJob,
  deleteTerminalJobs,
  failStaleRunningJobs,
  getAssignedJobsForWorker,
  getJob,
  retryJob,
  startJob,
  updateJobProgress,
} from "./repository.js";
import type { JobInput } from "./types.js";
import type { JobProvenance } from "./provenance.js";

// P4-3H: real temp-ish fixtures against the shared test DB (same pattern
// as the rest of this server's "real SQLite, not mocked" test style —
// see docs/PROJECT_STATUS.md's Tests Performed). Each test creates its
// own workstation row so runs don't collide with each other.
let nextWorkstationName = 0;
function makeWorkstation(overrides: { lastSeen?: string | null } = {}): number {
  const name = `P4-3H-test-worker-${Date.now()}-${nextWorkstationName++}`;
  const now = new Date().toISOString();
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO workstations (name, hostname, ip, mac_address, created_at, updated_at, last_seen)
       VALUES (?, ?, '10.0.0.1', 'AA:BB:CC:DD:EE:FF', ?, ?, ?)`,
    )
    .run(name, name, now, now, overrides.lastSeen ?? now);
  return Number(lastInsertRowid);
}

function isoMinusMs(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

const EMPTY_PROVENANCE: JobProvenance = {
  project_id: null,
  project_name: null,
  job_id: null,
  job_name: null,
  shot_id: null,
  shot_code: null,
  version_id: null,
  version_no: null,
  uploaded_by_user_id: null,
  uploaded_by_name: null,
  uploaded_at: null,
};

function newTestJob(overrides: Partial<JobInput> = {}) {
  return createJob({
    type: "test",
    priority: 0,
    input: null,
    depends_on: null,
    required_software: null,
    origin: null,
    provenance: null,
    ...overrides,
  });
}

test("getAssignedJobsForWorker returns every ASSIGNED job for that worker, not just one", () => {
  const workerId = makeWorkstation();
  const a = newTestJob();
  const b = newTestJob();
  db.prepare(`UPDATE jobs SET status = 'ASSIGNED', worker_id = ?, gpu_slot = 0 WHERE id = ?`).run(workerId, a.id);
  db.prepare(`UPDATE jobs SET status = 'ASSIGNED', worker_id = ?, gpu_slot = 1 WHERE id = ?`).run(workerId, b.id);

  const assigned = getAssignedJobsForWorker(workerId);
  assert.deepEqual(
    assigned.map((j) => j.id),
    [a.id, b.id],
  );
});

test("startJob and updateJobProgress both refresh last_progress_at", () => {
  const workerId = makeWorkstation();
  const job = newTestJob();
  db.prepare(`UPDATE jobs SET status = 'ASSIGNED', worker_id = ? WHERE id = ?`).run(workerId, job.id);

  startJob(job.id);
  const afterStart = getJob(job.id)!;
  assert.equal(afterStart.status, "RUNNING");
  assert.ok(afterStart.last_progress_at, "last_progress_at should be set on start");

  updateJobProgress(job.id, workerId, 42);
  const afterProgress = getJob(job.id)!;
  assert.equal(afterProgress.progress, 42);
  assert.ok(afterProgress.last_progress_at);
});

test("failStaleRunningJobs marks STALE_EXECUTION when the worker is online but the job's own lease expired", () => {
  // This is the exact bug this milestone fixes: job #35 (2026-09-02) got
  // orphaned RUNNING forever because its Agent process restarted
  // mid-job — the worker kept heartbeating fine, but nothing was ever
  // reporting progress for that specific job again. The old
  // worker-last_seen-only check could never catch this.
  const workerId = makeWorkstation({ lastSeen: new Date().toISOString() }); // worker online right now
  const job = newTestJob();
  db.prepare(
    `UPDATE jobs SET status = 'RUNNING', worker_id = ?, started_at = ?, last_progress_at = ? WHERE id = ?`,
  ).run(workerId, isoMinusMs(60_000), isoMinusMs(60_000), job.id); // last progress 60s ago, well past the 30s lease

  failStaleRunningJobs();

  const failed = getJob(job.id)!;
  assert.equal(failed.status, "FAILED");
  assert.match(failed.error ?? "", /STALE_EXECUTION/);
  assert.ok(failed.finished_at);
});

test("failStaleRunningJobs leaves a RUNNING job alone when its lease is still fresh", () => {
  const workerId = makeWorkstation({ lastSeen: new Date().toISOString() });
  const job = newTestJob();
  db.prepare(
    `UPDATE jobs SET status = 'RUNNING', worker_id = ?, started_at = ?, last_progress_at = ? WHERE id = ?`,
  ).run(workerId, isoMinusMs(2_000), isoMinusMs(2_000), job.id);

  failStaleRunningJobs();

  const stillRunning = getJob(job.id)!;
  assert.equal(stillRunning.status, "RUNNING");
});

test("failStaleRunningJobs still fails a job for the old reason when the whole worker is offline, even with a fresh lease", () => {
  const workerId = makeWorkstation({ lastSeen: isoMinusMs(120_000) }); // worker offline
  const job = newTestJob();
  db.prepare(
    `UPDATE jobs SET status = 'RUNNING', worker_id = ?, started_at = ?, last_progress_at = ? WHERE id = ?`,
  ).run(workerId, new Date().toISOString(), new Date().toISOString(), job.id); // lease is fresh, but the worker itself is gone

  failStaleRunningJobs();

  const failed = getJob(job.id)!;
  assert.equal(failed.status, "FAILED");
  assert.match(failed.error ?? "", /Worker went offline/);
});

test("deleteJob removes a terminal job for good", () => {
  const job = newTestJob();
  db.prepare(`UPDATE jobs SET status = 'COMPLETED', finished_at = ? WHERE id = ?`).run(new Date().toISOString(), job.id);

  const result = deleteJob(job.id);

  assert.equal(result, "deleted");
  assert.equal(getJob(job.id), undefined);
});

test("deleteJob refuses a job that is still QUEUED/ASSIGNED/RUNNING", () => {
  const job = newTestJob();
  // Freshly created jobs start QUEUED — no status update needed.

  const result = deleteJob(job.id);

  assert.equal(result, "still_active");
  assert.ok(getJob(job.id), "job must not have been deleted");
});

test("deleteJob reports not_found for a nonexistent id", () => {
  assert.equal(deleteJob(999_999_999), "not_found");
});

test("deleteTerminalJobs deletes every terminal job at once, leaving active ones alone", () => {
  // Shared test DB, not isolated per test (same pattern as the rest of
  // this file) -- assert on the specific fixtures created here rather
  // than an exact global count, since earlier tests in this file may
  // have left their own terminal (e.g. FAILED) rows behind.
  const workerId = makeWorkstation();
  const completed = newTestJob();
  db.prepare(`UPDATE jobs SET status = 'COMPLETED', finished_at = ? WHERE id = ?`).run(new Date().toISOString(), completed.id);
  const failed = newTestJob();
  db.prepare(`UPDATE jobs SET status = 'FAILED', finished_at = ? WHERE id = ?`).run(new Date().toISOString(), failed.id);
  const active = newTestJob();
  db.prepare(`UPDATE jobs SET status = 'RUNNING', worker_id = ?, started_at = ? WHERE id = ?`).run(
    workerId,
    new Date().toISOString(),
    active.id,
  );

  const deletedCount = deleteTerminalJobs();

  assert.ok(deletedCount >= 2, "should have deleted at least the 2 terminal jobs created here");
  assert.equal(getJob(completed.id), undefined);
  assert.equal(getJob(failed.id), undefined);
  assert.ok(getJob(active.id), "a still-RUNNING job must survive a bulk clear");

  db.prepare(`DELETE FROM jobs WHERE id = ?`).run(active.id); // tidy up manually -- deleteJob would refuse it (not terminal)
});

test("createJob stores origin/provenance and stamps engine_queued_at", () => {
  const job = newTestJob({
    origin: "website_shot_version",
    provenance: {
      project_id: "P-1",
      project_name: "Demo Project",
      job_id: "WJ-9",
      job_name: "Hero shot comp",
      shot_id: "S-3",
      shot_code: "SH0030",
      version_id: "V-7",
      version_no: 4,
      uploaded_by_user_id: "U-11",
      uploaded_by_name: "artist.one",
      uploaded_at: "2026-09-05T04:00:00.000Z",
    },
  });

  const stored = getJob(job.id)!;
  assert.equal(stored.origin, "website_shot_version");
  assert.equal(JSON.parse(stored.provenance!).shot_code, "SH0030");
  assert.equal(JSON.parse(stored.provenance!).version_no, 4);
  assert.ok(stored.engine_queued_at, "engine_queued_at should be stamped at creation");
  assert.equal(stored.assigned_at, null);
  assert.equal(stored.completed_at, null);
  assert.equal(stored.failed_at, null);
});

test("a job created without provenance stays null rather than being backfilled with a guess", () => {
  const stored = getJob(newTestJob().id)!;
  assert.equal(stored.origin, null);
  assert.equal(stored.provenance, null);
});

test("completeJob stamps completed_at on success and failed_at on failure, never both", () => {
  const workerId = makeWorkstation();
  const succeeded = newTestJob();
  db.prepare(`UPDATE jobs SET status = 'RUNNING', worker_id = ? WHERE id = ?`).run(workerId, succeeded.id);
  completeJob(succeeded.id, workerId, true, null, null);

  const ok = getJob(succeeded.id)!;
  assert.equal(ok.status, "COMPLETED");
  assert.ok(ok.completed_at);
  assert.equal(ok.failed_at, null);
  assert.equal(ok.completed_at, ok.finished_at, "completed_at and the pre-existing finished_at agree");

  const broke = newTestJob();
  db.prepare(`UPDATE jobs SET status = 'RUNNING', worker_id = ? WHERE id = ?`).run(workerId, broke.id);
  completeJob(broke.id, workerId, false, null, "boom");

  const failed = getJob(broke.id)!;
  assert.equal(failed.status, "FAILED");
  assert.ok(failed.failed_at);
  assert.equal(failed.completed_at, null);
});

test("failStaleRunningJobs stamps failed_at too, not just finished_at", () => {
  const workerId = makeWorkstation({ lastSeen: isoMinusMs(120_000) });
  const job = newTestJob();
  db.prepare(`UPDATE jobs SET status = 'RUNNING', worker_id = ?, started_at = ?, last_progress_at = ? WHERE id = ?`).run(
    workerId,
    isoMinusMs(60_000),
    isoMinusMs(60_000),
    job.id,
  );

  failStaleRunningJobs();

  const failed = getJob(job.id)!;
  assert.ok(failed.failed_at, "an auto-failed job must be auditable like a worker-reported failure");
});

test("retryJob re-stamps engine_queued_at, clears the previous attempt's stamps, and keeps provenance", () => {
  const workerId = makeWorkstation();
  const job = newTestJob({ origin: "admin_manual", provenance: { ...EMPTY_PROVENANCE, uploaded_by_name: "admin" } });
  db.prepare(
    `UPDATE jobs SET status = 'FAILED', worker_id = ?, assigned_at = ?, started_at = ?, finished_at = ?, failed_at = ?
       WHERE id = ?`,
  ).run(workerId, isoMinusMs(60_000), isoMinusMs(50_000), isoMinusMs(40_000), isoMinusMs(40_000), job.id);
  const queuedBefore = getJob(job.id)!.engine_queued_at;

  retryJob(job.id);

  const requeued = getJob(job.id)!;
  assert.equal(requeued.status, "QUEUED");
  assert.equal(requeued.assigned_at, null);
  assert.equal(requeued.failed_at, null);
  assert.notEqual(requeued.engine_queued_at, queuedBefore, "the retry is a new queue entry, with its own wait time");
  assert.equal(requeued.origin, "admin_manual", "where a job came from doesn't change because it was retried");
  assert.equal(JSON.parse(requeued.provenance!).uploaded_by_name, "admin");
});

test("deleteTerminalJobs returns 0 when there is nothing terminal to delete", () => {
  // Best-effort: only meaningful if the shared DB happens to have no
  // terminal jobs left at this exact point, which isn't guaranteed given
  // other tests in this file -- so this asserts the weaker, always-true
  // property instead: calling it twice in a row, the second call always
  // returns 0 (nothing left the first call didn't already take).
  deleteTerminalJobs();
  assert.equal(deleteTerminalJobs(), 0);
});
