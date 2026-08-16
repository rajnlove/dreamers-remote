import { listWorkstations } from "../workstation/repository.js";
import { getMetrics } from "../agent/metricsCache.js";
import { isAgentOnline } from "../agent/onlineStatus.js";

export interface GpuSlot {
  workstationId: number;
  workstationName: string;
  gpuIndex: number;
  gpuName: string;
}

export interface WorkerInfo {
  workstationId: number;
  workstationName: string;
  agentOnline: boolean;
  capabilities: string[];
  gpuSlots: GpuSlot[];
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
        capabilities: metrics?.capabilities ?? [],
        gpuSlots: (metrics?.gpus ?? []).map((gpu) => ({
          workstationId: ws.id,
          workstationName: ws.name,
          gpuIndex: gpu.index,
          gpuName: gpu.name,
        })),
      };
    });
}
