import { Router } from "express";
import { createJobOnce } from "../job/idempotency.js";
import { cancelJob, createJob, deleteJob, deleteTerminalJobs, getJob, listJobs, retryJob } from "../job/repository.js";
import { runScheduler } from "../job/scheduler.js";
import { validateCreateInput } from "../job/validation.js";
import { requireAdmin } from "../auth/middleware.js";
import { ConflictError, NotFoundError, ValidationError } from "../workstation/errors.js";

// Mounted behind requireAuth in index.ts, same as workstationsRouter.
export const jobsRouter = Router();

function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError("id must be a positive integer");
  }
  return id;
}

jobsRouter.get("/", (_req, res) => {
  res.json(listJobs());
});

jobsRouter.get("/:id", (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const job = getJob(id);
    if (!job) throw new NotFoundError("Job not found");
    res.json(job);
  } catch (err) {
    next(err);
  }
});

jobsRouter.post("/", (req, res, next) => {
  try {
    const input = validateCreateInput(req.body);
    if (input.depends_on !== null && !getJob(input.depends_on)) {
      throw new NotFoundError(`depends_on job ${input.depends_on} not found`);
    }
    const requestKey = req.get("Idempotency-Key");
    const created = requestKey ? createJobOnce(req.session.userId!, requestKey, input) : createJob(input);
    // P3-3: try to assign immediately (a worker may already be free) —
    // also retried on every Agent heartbeat, so this isn't the only chance.
    runScheduler();
    res.status(201).json(getJob(created.id));
  } catch (err) {
    next(err);
  }
});

jobsRouter.post("/:id/cancel", (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const job = cancelJob(id);
    if (!job) throw new NotFoundError("Job not found");
    res.json(job);
  } catch (err) {
    next(err);
  }
});

// P3-5: only valid from FAILED — see retryJob's comment. Re-queued jobs
// get picked up like any other by the next scheduler run.
jobsRouter.post("/:id/retry", (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const job = retryJob(id);
    if (!job) throw new NotFoundError("Job not found");
    if (job.status !== "QUEUED") {
      throw new ValidationError(`Job is ${job.status}, not FAILED — nothing to retry`);
    }
    runScheduler();
    res.json(getJob(id));
  } catch (err) {
    next(err);
  }
});

// Permanent removal, admin-only (same gate as workstation restart/
// shutdown — destructive enough to warrant it) — see repository.ts's
// deleteJob for why this only works once a job is terminal. Cancel a
// still-active job first, then delete it.
jobsRouter.delete("/:id", requireAdmin, (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const result = deleteJob(id);
    if (result === "not_found") throw new NotFoundError("Job not found");
    if (result === "still_active") {
      throw new ConflictError("Job is still QUEUED/ASSIGNED/RUNNING — cancel it first, then delete");
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Bulk "clear history" — every terminal job at once, admin-only (same
// gate as the single-job delete above). See repository.ts's
// deleteTerminalJobs for the atomicity/dependency-ordering detail.
// QUEUED/ASSIGNED/RUNNING jobs are silently left alone, not an error —
// this is "clear what can be cleared", not "clear everything or fail".
jobsRouter.delete("/", requireAdmin, (_req, res, next) => {
  try {
    const deleted = deleteTerminalJobs();
    res.json({ deleted });
  } catch (err) {
    next(err);
  }
});
