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
  getAssignedJobsForWorker,
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

  // P3-4/P3-5/P4-3H: the Agent reports progress of every job it's
  // currently running as part of every heartbeat, not a separate
  // endpoint. runningJobs (plural) is the concurrent-execution shape; an
  // Agent binary not yet redeployed with that support still sends the
  // old single runningJob field — normalize both into one list here so
  // the rest of this handler doesn't care which era of Agent it's
  // talking to. For any job no longer RUNNING server-side (an admin
  // cancelled it via POST /api/jobs/:id/cancel while the Agent was
  // mid-run), tell it to stop rather than silently swallowing progress
  // updates for a job the Agent doesn't know was pulled out from under
  // it.
  const runningJobs = body.runningJobs ?? (body.runningJob ? [body.runningJob] : []);
  const cancelJobIds: number[] = [];
  for (const rj of runningJobs) {
    if (isJobStillRunning(rj.id, workstationId)) {
      updateJobProgress(rj.id, workstationId, rj.progress, rj.fps ?? null, rj.etaSeconds ?? null);
    } else {
      cancelJobIds.push(rj.id);
    }
  }

  // P3-3/P3-5: a worker just reported fresh capabilities/online status —
  // retry assignment in case something was QUEUED with nothing free to
  // take it before now, and free up any job whose worker went stale.
  runScheduler();

  // P4-3H: hand out every ASSIGNED job this worker has, not just one —
  // true concurrent per-GPU-slot execution is now implemented on the
  // Agent side (see Worker.cs), so a worker with N free GPU slots can be
  // running N jobs at once. Skip any job already reported as running
  // this same tick (belt-and-suspenders; shouldn't overlap in practice
  // since the scheduler never double-assigns a slot). An Agent that
  // hasn't been redeployed yet only reads the legacy singular `job`
  // field below (jobs[0]) and, thanks to its own client-side "one job at
  // a time" gate, simply leaves any extra ASSIGNED job sitting until a
  // later heartbeat — same as before, no regression.
  const alreadyRunning = new Set(runningJobs.map((rj) => rj.id));
  const newlyAssigned = getAssignedJobsForWorker(workstationId).filter((j) => !alreadyRunning.has(j.id));
  for (const assigned of newlyAssigned) startJob(assigned.id);
  // P4-5 prep: gpuSlot lets the Agent explicitly pin GPU work to the slot
  // the scheduler actually reserved (job/scheduler.ts) instead of
  // leaving device selection to the encoder/model's own default, which
  // could otherwise let two concurrent jobs land on the same physical
  // GPU on a multi-GPU workstation.
  const jobs = newlyAssigned.map((assigned) => ({
    id: assigned.id,
    type: assigned.type,
    input: assigned.input,
    gpuSlot: assigned.gpu_slot,
  }));

  // P2-8: no inbound listener on the Agent — a pending restart/shutdown
  // rides the next heartbeat response instead of being pushed. See
  // agent/commands.ts and docs/PROJECT_STATUS.md.
  const command = takePendingCommand(workstationId);

  res.json({
    ok: true,
    ...(command ? { command } : {}),
    // Legacy singular fields, for an Agent binary not yet redeployed.
    ...(jobs[0] ? { job: jobs[0] } : {}),
    ...(cancelJobIds[0] !== undefined ? { cancelJobId: cancelJobIds[0] } : {}),
    // P4-3H: plural fields, for an Agent with concurrent-execution support.
    jobs,
    cancelJobIds,
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
