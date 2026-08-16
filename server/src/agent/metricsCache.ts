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
  runningJob?: { id: number; progress: number };
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
