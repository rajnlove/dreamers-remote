import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../database/db.js";
import { createJob, deleteJob, deleteTerminalJobs, jobCleanup, retryJob } from "./repository.js";

test("upload cleanup survives history deletion and prevents retry/delete races", () => {
  const projectId = `upload-${randomUUID()}`;
  const create = () => createJob({ type: "ffmpeg", input: JSON.stringify({ projectId }), priority: 0, depends_on: null, required_software: null, origin: "website_project_upload", provenance: null });
  const job = create();
  assert.equal(jobCleanup(job.id, projectId).allowed, false);
  assert.throws(() => jobCleanup(job.id, projectId, true));
  assert.throws(() => jobCleanup(job.id, `upload-${randomUUID()}`, true));
  db.prepare("UPDATE jobs SET status = 'FAILED' WHERE id = ?").run(job.id);
  assert.equal(jobCleanup(job.id, projectId, true).allowed, true);
  assert.throws(() => retryJob(job.id), /released for cleanup/);
  assert.equal(deleteJob(job.id), "deleted");
  assert.deepEqual(jobCleanup(job.id, projectId), { id: job.id, status: "FAILED", allowed: true, archived: true });
  assert.equal(jobCleanup(job.id, projectId, true).allowed, true, "cleanup retry is idempotent");
  const cancelled = create();
  db.prepare("UPDATE jobs SET status = 'CANCELLED' WHERE id = ?").run(cancelled.id);
  deleteTerminalJobs();
  assert.equal(jobCleanup(cancelled.id, projectId).allowed, false);
  assert.throws(() => jobCleanup(cancelled.id, projectId, true), /still be using/);
  assert.throws(() => jobCleanup(999999, projectId), /unavailable/, "unknown deleted jobs fail closed");
});
