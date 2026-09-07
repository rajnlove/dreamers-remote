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
import { isAgentCommand, queueCommand } from "../agent/commands.js";
import { requireAdmin } from "../auth/middleware.js";
import { recordAudit } from "../audit/repository.js";
import type { Workstation } from "../workstation/types.js";

export const workstationsRouter = Router();

const UNSET_MAC = "00:00:00:00:00:00";

function parseId(raw: string | undefined): number {
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
    recordAudit({
      action: "workstation.create",
      req,
      targetType: "workstation",
      targetId: created.id,
      targetLabel: created.name,
      detail: { ip: created.ip, hostname: created.hostname },
    });
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
    // Field NAMES only, not a before/after dump: the interesting question
    // months later is "who took CGI-01 out of the render pool", and the
    // values are already visible on the workstation itself.
    recordAudit({
      action: "workstation.update",
      req,
      targetType: "workstation",
      targetId: updated.id,
      targetLabel: updated.name,
      detail: { fields: Object.keys(input), ...(input.jobs_enabled === undefined ? {} : { jobs_enabled: input.jobs_enabled }) },
    });
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
    recordAudit({ action: "workstation.wake", req, targetType: "workstation", targetId: ws.id, targetLabel: ws.name });
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
    // The token itself is never logged — only that one was issued.
    recordAudit({ action: "workstation.agent_token", req, targetType: "workstation", targetId: ws.id, targetLabel: ws.name });
    res.json(createRegistrationToken(id));
  } catch (err) {
    next(err);
  }
});

// Admin-only (see requireAdmin) — restart/shutdown are destructive enough
// to warrant gating separately from the rest of this admin-only router.
// Structured command enum only, never arbitrary shell (docs/SECURITY.md).
// Delivered on the Agent's next heartbeat, not pushed — see agent/commands.ts.
workstationsRouter.post("/:id/command", requireAdmin, (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const ws = getWorkstation(id);
    if (!ws) throw new NotFoundError("Workstation not found");

    const { command } = req.body as Record<string, unknown>;
    if (!isAgentCommand(command)) {
      throw new ValidationError("command must be one of: restart, shutdown");
    }
    if (!ws.agent_id) {
      throw new ValidationError("Workstation has no Agent paired");
    }

    const commandLogId = queueCommand(id, command, req.session.userId!);
    recordAudit({
      action: "workstation.command",
      req,
      targetType: "workstation",
      targetId: ws.id,
      targetLabel: ws.name,
      detail: { command, commandLogId },
    });
    res.status(202).json({ queued: true, commandLogId });
  } catch (err) {
    next(err);
  }
});

workstationsRouter.delete("/:id", (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    // Read before deleting: after the row is gone there is no name left to
    // snapshot, and a deletion with no label is the least useful audit row.
    const existing = getWorkstation(id);
    const deleted = deleteWorkstation(id);
    if (!deleted) throw new NotFoundError("Workstation not found");
    recordAudit({
      action: "workstation.delete",
      req,
      targetType: "workstation",
      targetId: id,
      targetLabel: existing?.name,
      detail: existing ? { ip: existing.ip, hostname: existing.hostname } : undefined,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
