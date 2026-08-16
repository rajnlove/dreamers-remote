import { Router } from "express";
import { listWorkers } from "../job/workers.js";

// P3-2: read-only view of worker capabilities + GPU slots, derived from
// Agent heartbeat data. Mounted behind requireAuth in index.ts.
export const workersRouter = Router();

workersRouter.get("/", (_req, res) => {
  res.json(listWorkers());
});
