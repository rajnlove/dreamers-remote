import { listWorkstations } from "../workstation/repository.js";
import { getMetrics } from "../agent/metricsCache.js";
import { isAgentOnline } from "../agent/onlineStatus.js";

export interface GpuSlot {
  workstationId: number;
  workstationName: string;
  gpuIndex: number;
  gpuName: string;
  // P3-6: current utilization, for threshold-based gating — a slot can
  // be heavily used by something outside the job engine entirely (an
  // artist's interactive session) without a job of ours occupying it.
  utilizationPercent: number;
}

export interface WorkerInfo {
  workstationId: number;
  workstationName: string;
  agentOnline: boolean;
  // P3-6: manual admin gate — see workstations.jobs_enabled.
  jobsEnabled: boolean;
  capabilities: string[];
  // P3-8: mechanism only -- { [softwareName]: version }, as last
  // reported by the Agent's heartbeat.
  softwareVersions: Record<string, string>;
  gpuSlots: GpuSlot[];
  // P3-6: current usage, for threshold-based gating in scheduler.ts.
  // Null when the Agent hasn't reported that metric (e.g. no NVML GPU).
  cpuUtilizationPercent: number | null;
  memoryUsagePercent: number | null;
}

// P3-2: a read-only view derived from what the Agent already reports on
// every heartbeat (agent/metricsCache.ts's cached gpus[]/capabilities) —
// no new storage. Each GPU is its own independently addressable slot
// (workstationId + gpuIndex), per MASTER_PROJECT_SPEC.md §3's "1 machine
// != 1 GPU worker slot" — a 2-GPU machine reports 2 slots here. P3-3's
// scheduler will read this to decide where a job gets assigned; nothing
// assigns jobs yet.
export function listWorkers(): WorkerInfo[] {
  return listWorkstations()
    .filter((ws) => ws.agent_id !== null)
    .map((ws): WorkerInfo => {
      const metrics = getMetrics(ws.id);
      return {
        workstationId: ws.id,
        workstationName: ws.name,
        agentOnline: isAgentOnline(ws.last_seen),
        jobsEnabled: ws.jobs_enabled,
        capabilities: metrics?.capabilities ?? [],
        softwareVersions: metrics?.softwareVersions ?? {},
        gpuSlots: (metrics?.gpus ?? []).map((gpu) => ({
          workstationId: ws.id,
          workstationName: ws.name,
          gpuIndex: gpu.index,
          gpuName: gpu.name,
          utilizationPercent: gpu.utilizationPercent,
        })),
        cpuUtilizationPercent: metrics?.cpu?.utilizationPercent ?? null,
        memoryUsagePercent: metrics?.memory?.usagePercent ?? null,
      };
    });
}
