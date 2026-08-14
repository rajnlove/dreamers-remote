import { Router } from "express";
import {
  createWorkstation,
  deleteWorkstation,
  getWorkstation,
  listWorkstations,
  updateWorkstation,
} from "../workstation/repository.js";
import { checkTcpPort } from "../workstation/status.js";
import { validateCreateInput, validateUpdateInput } from "../workstation/validation.js";
import { NotFoundError, ValidationError } from "../workstation/errors.js";

export const workstationsRouter = Router();

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError("id must be a positive integer");
  }
  return id;
}

workstationsRouter.get("/", (_req, res) => {
  res.json(listWorkstations());
});

workstationsRouter.get("/status", async (_req, res) => {
  const workstations = listWorkstations();
  const results = await Promise.all(
    workstations.map(async (ws) => ({
      id: ws.id,
      name: ws.name,
      online: ws.enabled ? await checkTcpPort(ws.ip, ws.vnc_port) : false,
    })),
  );
  res.json(results);
});

workstationsRouter.get("/:id/status", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const ws = getWorkstation(id);
    if (!ws) throw new NotFoundError("Workstation not found");
    const online = ws.enabled ? await checkTcpPort(ws.ip, ws.vnc_port) : false;
    res.json({ id: ws.id, name: ws.name, online, checked_at: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

workstationsRouter.get("/:id", (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const ws = getWorkstation(id);
    if (!ws) throw new NotFoundError("Workstation not found");
    res.json(ws);
  } catch (err) {
    next(err);
  }
});

workstationsRouter.post("/", (req, res, next) => {
  try {
    const input = validateCreateInput(req.body);
    const created = createWorkstation(input);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

workstationsRouter.patch("/:id", (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const input = validateUpdateInput(req.body);
    const updated = updateWorkstation(id, input);
    if (!updated) throw new NotFoundError("Workstation not found");
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

workstationsRouter.delete("/:id", (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const deleted = deleteWorkstation(id);
    if (!deleted) throw new NotFoundError("Workstation not found");
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
