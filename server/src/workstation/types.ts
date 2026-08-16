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
  // Phase 2 (P2-5) — set by the Agent via /api/agent/register and
  // /api/agent/heartbeat, never by the workstation CRUD API (not part of
  // WorkstationInput below).
  agent_id: string | null;
  last_seen: string | null;
  agent_version: string | null;
  os: string | null;
  // Phase 3 (P3-6) — manual admin gate on job assignment, distinct from
  // `enabled` (which controls whether the workstation is monitored/
  // probed at all). See job/scheduler.ts.
  jobs_enabled: boolean;
}

export interface WorkstationInput {
  name: string;
  hostname: string;
  ip: string;
  mac_address: string;
  vnc_port: number;
  location: string | null;
  description: string | null;
  enabled: boolean;
  jobs_enabled: boolean;
}

export type WorkstationUpdateInput = Partial<WorkstationInput>;
