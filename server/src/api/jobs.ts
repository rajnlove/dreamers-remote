import { Router } from "express";
import { cancelJob, createJob, getJob, listJobs } from "../job/repository.js";
import { validateCreateInput } from "../job/validation.js";
import { NotFoundError, ValidationError } from "../workstation/errors.js";

// P3-1: no scheduler yet (P3-3) — POST just queues a row, nothing
// assigns it to a worker. Mounted behind requireAuth in index.ts, same
// as workstationsRouter.
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
    const created = createJob(input);
    res.status(201).json(created);
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
