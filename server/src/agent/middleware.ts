import type { NextFunction, Request, Response } from "express";
import { verifyAgentCredential } from "./agentRepository.js";

export interface AgentAuthenticatedRequest extends Request {
  workstationId: number;
}

/**
 * Agent-facing routes (/api/agent/heartbeat) are authenticated by the
 * per-agent credential issued at registration time — never by the user's
 * session cookie. A compromised agent credential should only ever be able
 * to send heartbeats for its own workstation, not reach /api/workstations
 * or the VNC proxy, and vice versa. See docs/SECURITY.md.
 */
export function requireAgentAuth(req: Request, res: Response, next: NextFunction): void {
  const agentId = req.header("X-Agent-Id");
  const credential = req.header("X-Agent-Credential");

  if (!agentId || !credential) {
    res.status(401).json({ error: "Agent authentication required" });
    return;
  }

  const workstationId = verifyAgentCredential(agentId, credential);
  if (workstationId === null) {
    res.status(401).json({ error: "Invalid agent credentials" });
    return;
  }

  (req as AgentAuthenticatedRequest).workstationId = workstationId;
  next();
}
