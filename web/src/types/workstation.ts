export interface Workstation {
  id: number;
  name: string;
  hostname: string;
  ip: string;
  mac_address: string;
  vnc_port: number;
  location: string | null;
  description: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  agent_id: string | null;
  last_seen: string | null;
  agent_version: string | null;
  os: string | null;
}

export interface CpuMetrics {
  name: string;
  logicalProcessorCount: number;
  physicalCoreCount: number;
  utilizationPercent: number | null;
}

export interface MemoryMetrics {
  totalMb: number;
  usedMb: number;
  availableMb: number;
  usagePercent: number;
}

export interface GpuMetrics {
  index: number;
  name: string;
  utilizationPercent: number;
  vramUsedMb: number;
  vramTotalMb: number;
  vramUsagePercent: number;
  temperatureCelsius: number | null;
}

export interface DiskMetrics {
  name: string;
  totalMb: number;
  usedMb: number;
  freeMb: number;
  usagePercent: number;
}

export interface ProcessMetrics {
  name: string;
  running: boolean;
  pid: number | null;
  ramMb: number | null;
}

export interface AgentMetrics {
  receivedAt: string;
  hostname?: string;
  os?: string;
  osVersion?: string;
  architecture?: string;
  uptimeSeconds?: number;
  agentVersion?: string;
  cpu?: CpuMetrics;
  memory?: MemoryMetrics;
  gpus?: GpuMetrics[];
  disks?: DiskMetrics[];
  processes?: ProcessMetrics[];
}

export interface WorkstationStatus {
  id: number;
  name: string;
  vncOnline: boolean;
  agentOnline: boolean;
  lastSeen: string | null;
  metrics: AgentMetrics | null;
}
