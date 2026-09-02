// In-memory only — deliberately not persisted to SQLite on every heartbeat
// (every 5s per workstation would make SQLite a time-series DB, which it
// isn't meant to be; see docs/PROJECT_STATUS.md Phase 2 notes). Lost on
// server restart, which is fine — the next heartbeat repopulates it within
// one interval.

export interface AgentCpuMetrics {
  name: string;
  logicalProcessorCount: number;
  physicalCoreCount: number;
  utilizationPercent: number | null;
}

export interface AgentMemoryMetrics {
  totalMb: number;
  usedMb: number;
  availableMb: number;
  usagePercent: number;
}

export interface AgentGpuMetrics {
  index: number;
  name: string;
  utilizationPercent: number;
  vramUsedMb: number;
  vramTotalMb: number;
  vramUsagePercent: number;
  temperatureCelsius: number | null;
}

export interface AgentDiskMetrics {
  name: string;
  totalMb: number;
  usedMb: number;
  freeMb: number;
  usagePercent: number;
}

export interface AgentProcessMetrics {
  name: string;
  running: boolean;
  pid: number | null;
  ramMb: number | null;
}

export interface AgentMetricsPayload {
  hostname?: string;
  os?: string;
  osVersion?: string;
  architecture?: string;
  uptimeSeconds?: number;
  agentVersion?: string;
  cpu?: AgentCpuMetrics;
  memory?: AgentMemoryMetrics;
  gpus?: AgentGpuMetrics[];
  disks?: AgentDiskMetrics[];
  processes?: AgentProcessMetrics[];
  // P3-2: job types this Agent can execute (see agent's WorkerCapabilities).
  capabilities?: string[];
  // P3-8: installed software versions, mechanism only (see agent's
  // WorkerSoftwareVersions) -- { [softwareName]: version }. Like the
  // rest of this heartbeat payload (agentVersion, runningJob, ...) this
  // is camelCase, not the snake_case used elsewhere in the API --
  // System.Text.Json on the Agent side serializes with CamelCase
  // naming policy (see ServerClient.cs).
  softwareVersions?: Record<string, string>;
  // P3-4: progress of the job the Agent is currently running, if any —
  // reported on every heartbeat while it's in flight (not a separate
  // endpoint, same "everything rides the heartbeat" pattern as P2-8).
  // P4-2: fps/etaSeconds are optional -- only FFmpeg-style jobs report
  // them (see agent's FfmpegJobRunner), the "test" job type doesn't.
  // P4-3H: legacy single-job field — still accepted from an
  // Agent binary that hasn't been redeployed with concurrent-execution
  // support yet. See runningJobs below and api/agent.ts's heartbeat
  // handler, which merges both into one list.
  runningJob?: { id: number; progress: number; fps?: number; etaSeconds?: number };
  // P4-3H: every job this Agent currently has in flight, one per active
  // GPU slot (or a single entry for a CPU-only worker) — the array
  // counterpart of runningJob above, sent by an Agent redeployed with
  // true concurrent per-GPU-slot execution instead of the old "one job
  // across the whole Agent" limitation. See docs/ROADMAP.md's P4-3H.
  runningJobs?: Array<{ id: number; progress: number; fps?: number; etaSeconds?: number }>;
}

export interface CachedMetrics extends AgentMetricsPayload {
  receivedAt: string;
}

const metricsByWorkstationId = new Map<number, CachedMetrics>();

export function setMetrics(workstationId: number, payload: AgentMetricsPayload): void {
  metricsByWorkstationId.set(workstationId, { ...payload, receivedAt: new Date().toISOString() });
}

export function getMetrics(workstationId: number): CachedMetrics | undefined {
  return metricsByWorkstationId.get(workstationId);
}
