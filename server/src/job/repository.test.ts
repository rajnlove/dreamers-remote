import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../database/db.js";
import {
  createJob,
  deleteJob,
  deleteTerminalJobs,
  failStaleRunningJobs,
  getAssignedJobsForWorker,
  getJob,
  startJob,
  updateJobProgress,
} from "./repository.js";

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

test("getAssignedJobsForWorker returns every ASSIGNED job for that worker, not just one", () => {
  const workerId = makeWorkstation();
  const a = createJob({ type: "test", priority: 0, input: null, depends_on: null, required_software: null });
  const b = createJob({ type: "test", priority: 0, input: null, depends_on: null, required_software: null });
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
  const job = createJob({ type: "test", priority: 0, input: null, depends_on: null, required_software: null });
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
  const job = createJob({ type: "test", priority: 0, input: null, depends_on: null, required_software: null });
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
  const job = createJob({ type: "test", priority: 0, input: null, depends_on: null, required_software: null });
  db.prepare(
    `UPDATE jobs SET status = 'RUNNING', worker_id = ?, started_at = ?, last_progress_at = ? WHERE id = ?`,
  ).run(workerId, isoMinusMs(2_000), isoMinusMs(2_000), job.id);

  failStaleRunningJobs();

  const stillRunning = getJob(job.id)!;
  assert.equal(stillRunning.status, "RUNNING");
});

test("failStaleRunningJobs still fails a job for the old reason when the whole worker is offline, even with a fresh lease", () => {
  const workerId = makeWorkstation({ lastSeen: isoMinusMs(120_000) }); // worker offline
  const job = createJob({ type: "test", priority: 0, input: null, depends_on: null, required_software: null });
  db.prepare(
    `UPDATE jobs SET status = 'RUNNING', worker_id = ?, started_at = ?, last_progress_at = ? WHERE id = ?`,
  ).run(workerId, new Date().toISOString(), new Date().toISOString(), job.id); // lease is fresh, but the worker itself is gone

  failStaleRunningJobs();

  const failed = getJob(job.id)!;
  assert.equal(failed.status, "FAILED");
  assert.match(failed.error ?? "", /Worker went offline/);
});

test("deleteJob removes a terminal job for good", () => {
  const job = createJob({ type: "test", priority: 0, input: null, depends_on: null, required_software: null });
  db.prepare(`UPDATE jobs SET status = 'COMPLETED', finished_at = ? WHERE id = ?`).run(new Date().toISOString(), job.id);

  const result = deleteJob(job.id);

  assert.equal(result, "deleted");
  assert.equal(getJob(job.id), undefined);
});

test("deleteJob refuses a job that is still QUEUED/ASSIGNED/RUNNING", () => {
  const job = createJob({ type: "test", priority: 0, input: null, depends_on: null, required_software: null });
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
  const completed = createJob({ type: "test", priority: 0, input: null, depends_on: null, required_software: null });
  db.prepare(`UPDATE jobs SET status = 'COMPLETED', finished_at = ? WHERE id = ?`).run(new Date().toISOString(), completed.id);
  const failed = createJob({ type: "test", priority: 0, input: null, depends_on: null, required_software: null });
  db.prepare(`UPDATE jobs SET status = 'FAILED', finished_at = ? WHERE id = ?`).run(new Date().toISOString(), failed.id);
  const active = createJob({ type: "test", priority: 0, input: null, depends_on: null, required_software: null });
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

test("deleteTerminalJobs returns 0 when there is nothing terminal to delete", () => {
  // Best-effort: only meaningful if the shared DB happens to have no
  // terminal jobs left at this exact point, which isn't guaranteed given
  // other tests in this file -- so this asserts the weaker, always-true
  // property instead: calling it twice in a row, the second call always
  // returns 0 (nothing left the first call didn't already take).
  deleteTerminalJobs();
  assert.equal(deleteTerminalJobs(), 0);
});
