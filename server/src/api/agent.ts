import { Router } from "express";
import { pairAgent, recordHeartbeat } from "../agent/agentRepository.js";
import { generateSecret } from "../agent/crypto.js";
import { requireAgentAuth, type AgentAuthenticatedRequest } from "../agent/middleware.js";
import { setMetrics, type AgentMetricsPayload } from "../agent/metricsCache.js";
import { consumeRegistrationToken } from "../agent/registrationTokens.js";
import { getWorkstation } from "../workstation/repository.js";
import { isAgentCommand, recordCommandResult, takePendingCommand } from "../agent/commands.js";
import { runScheduler } from "../job/scheduler.js";
import {
  completeJob,
  getAssignedJobForWorker,
  isJobStillRunning,
  startJob,
  updateJobProgress,
} from "../job/repository.js";

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

  // P3-4/P3-5: the Agent reports progress of whatever job it's currently
  // running as part of every heartbeat, not a separate endpoint. If that
  // job is no longer RUNNING server-side (an admin cancelled it via
  // POST /api/jobs/:id/cancel while the Agent was mid-run), tell it to
  // stop rather than silently swallowing progress updates for a job the
  // Agent doesn't know was pulled out from under it.
  let cancelJobId: number | undefined;
  if (body.runningJob) {
    if (isJobStillRunning(body.runningJob.id, workstationId)) {
      updateJobProgress(
        body.runningJob.id,
        workstationId,
        body.runningJob.progress,
        body.runningJob.fps ?? null,
        body.runningJob.etaSeconds ?? null,
      );
    } else {
      cancelJobId = body.runningJob.id;
    }
  }

  // P3-3/P3-5: a worker just reported fresh capabilities/online status —
  // retry assignment in case something was QUEUED with nothing free to
  // take it before now, and free up any job whose worker went stale.
  runScheduler();

  // P3-4: only hand out a new job if the Agent isn't already reporting
  // one in flight — it only runs one at a time for now (see
  // job/repository.ts's getAssignedJobForWorker comment). If there IS
  // capacity, this rides the same "no inbound listener" pattern P2-8's
  // commands already use: deliver in the heartbeat response, not pushed.
  let job: { id: number; type: string; input: string | null } | undefined;
  if (!body.runningJob) {
    const assigned = getAssignedJobForWorker(workstationId);
    if (assigned) {
      startJob(assigned.id);
      job = { id: assigned.id, type: assigned.type, input: assigned.input };
    }
  }

  // P2-8: no inbound listener on the Agent — a pending restart/shutdown
  // rides the next heartbeat response instead of being pushed. See
  // agent/commands.ts and docs/PROJECT_STATUS.md.
  const command = takePendingCommand(workstationId);

  res.json({
    ok: true,
    ...(command ? { command } : {}),
    ...(job ? { job } : {}),
    ...(cancelJobId !== undefined ? { cancelJobId } : {}),
  });
});

agentRouter.post("/command-result", requireAgentAuth, (req, res) => {
  const { workstationId } = req as AgentAuthenticatedRequest;
  const { command, ok, detail } = req.body as Record<string, unknown>;

  if (!isAgentCommand(command) || typeof ok !== "boolean") {
    res.status(400).json({ error: "command (restart|shutdown) and ok (boolean) are required" });
    return;
  }

  recordCommandResult(workstationId, command, ok, typeof detail === "string" ? detail : undefined);
  res.json({ ok: true });
});

agentRouter.post("/job-result", requireAgentAuth, (req, res) => {
  const { workstationId } = req as AgentAuthenticatedRequest;
  const { jobId, ok, output, error } = req.body as Record<string, unknown>;

  if (typeof jobId !== "number" || typeof ok !== "boolean") {
    res.status(400).json({ error: "jobId (number) and ok (boolean) are required" });
    return;
  }

  completeJob(
    jobId,
    workstationId,
    ok,
    typeof output === "string" ? output : null,
    typeof error === "string" ? error : null,
  );
  res.json({ ok: true });
});
