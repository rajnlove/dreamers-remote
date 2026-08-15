import { Router } from "express";
import { pairAgent, recordHeartbeat } from "../agent/agentRepository.js";
import { generateSecret } from "../agent/crypto.js";
import { requireAgentAuth, type AgentAuthenticatedRequest } from "../agent/middleware.js";
import { setMetrics, type AgentMetricsPayload } from "../agent/metricsCache.js";
import { consumeRegistrationToken } from "../agent/registrationTokens.js";
import { getWorkstation } from "../workstation/repository.js";

// Mounted at /api/agent, NOT behind requireAuth — these are called by the
// Agent itself, which has no user session. Authentication is per-route:
// /register consumes a one-time admin-issued token (see
// /api/workstations/:id/agent-token in api/workstations.ts), everything
// else requires the long-lived agent credential /register hands back.
export const agentRouter = Router();

agentRouter.post("/register", (req, res) => {
  const body = req.body as Record<string, unknown>;
  const { registrationToken, agentId, os, agentVersion } = body;

  if (typeof registrationToken !== "string" || typeof agentId !== "string" || !agentId.trim()) {
    res.status(400).json({ error: "registrationToken and agentId are required" });
    return;
  }

  let workstationId: number;
  try {
    workstationId = consumeRegistrationToken(registrationToken);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid registration token" });
    return;
  }

  const credential = generateSecret();
  pairAgent(
    workstationId,
    agentId,
    credential,
    typeof os === "string" ? os : undefined,
    typeof agentVersion === "string" ? agentVersion : undefined,
  );

  const workstation = getWorkstation(workstationId);
  res.json({
    workstationId,
    workstationName: workstation?.name,
    agentCredential: credential,
  });
});

agentRouter.post("/heartbeat", requireAgentAuth, (req, res) => {
  const { workstationId } = req as AgentAuthenticatedRequest;
  const body = req.body as AgentMetricsPayload;

  recordHeartbeat(workstationId, body.agentVersion, body.os);
  setMetrics(workstationId, body);

  res.json({ ok: true });
});
