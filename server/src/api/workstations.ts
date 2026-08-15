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
import { sendMagicPacket } from "../wol/wol.js";
import { createRegistrationToken } from "../agent/registrationTokens.js";
import { isAgentOnline } from "../agent/onlineStatus.js";
import { getMetrics } from "../agent/metricsCache.js";
import type { Workstation } from "../workstation/types.js";

export const workstationsRouter = Router();

const UNSET_MAC = "00:00:00:00:00:00";

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

// Two independent online signals, not one boolean (see docs/ARCHITECTURE.md
// Phase 2 section): vncOnline is the pre-existing TCP probe to vnc_port;
// agentOnline is derived from Agent heartbeat freshness (P2-5). A
// workstation can be vncOnline without agentOnline (no Agent installed
// yet) or vice versa (Agent up, UltraVNC down) — the dashboard should
// show both, not collapse them into one status.
async function buildStatusEntry(ws: Workstation) {
  return {
    id: ws.id,
    name: ws.name,
    vncOnline: ws.enabled ? await checkTcpPort(ws.ip, ws.vnc_port) : false,
    agentOnline: isAgentOnline(ws.last_seen),
    lastSeen: ws.last_seen,
    metrics: getMetrics(ws.id) ?? null,
  };
}

workstationsRouter.get("/status", async (_req, res) => {
  const workstations = listWorkstations();
  const results = await Promise.all(workstations.map(buildStatusEntry));
  res.json(results);
});

// Single-workstation version of /status, for the detail page (P2-7) —
// avoids fetching every workstation's metrics just to show one.
workstationsRouter.get("/:id/metrics", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const ws = getWorkstation(id);
    if (!ws) throw new NotFoundError("Workstation not found");
    res.json(await buildStatusEntry(ws));
  } catch (err) {
    next(err);
  }
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

workstationsRouter.post("/:id/wake", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const ws = getWorkstation(id);
    if (!ws) throw new NotFoundError("Workstation not found");
    if (ws.mac_address.toUpperCase() === UNSET_MAC) {
      throw new ValidationError("mac_address is not set for this workstation");
    }
    await sendMagicPacket(ws.mac_address);
    res.json({ sent: true });
  } catch (err) {
    next(err);
  }
});

// Admin-only (this router is mounted behind requireAuth in index.ts).
// Issues a short-lived, single-use token the Agent trades for a
// long-lived credential via POST /api/agent/register. See docs/SECURITY.md.
workstationsRouter.post("/:id/agent-token", (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const ws = getWorkstation(id);
    if (!ws) throw new NotFoundError("Workstation not found");
    res.json(createRegistrationToken(id));
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
