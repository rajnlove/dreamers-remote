import type { Workstation, WorkstationStatus } from "../types/workstation";
import { API_BASE_URL } from "./config";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { credentials: "include", ...init });
  if (!res.ok) {
    let message = `Request to ${path} failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // response wasn't JSON — keep the generic message
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function listWorkstations(): Promise<Workstation[]> {
  return request<Workstation[]>("/api/workstations");
}

/** vncOnline (TCP probe) + agentOnline (heartbeat freshness) + cached metrics per workstation, polled every 5s by Dashboard. */
export function getWorkstationsStatus(): Promise<WorkstationStatus[]> {
  return request<WorkstationStatus[]>("/api/workstations/status");
}

export function getWorkstation(id: number): Promise<Workstation> {
  return request<Workstation>(`/api/workstations/${id}`);
}

/** Single-workstation version of getWorkstationsStatus, for the detail page. */
export function getWorkstationMetrics(id: number): Promise<WorkstationStatus> {
  return request<WorkstationStatus>(`/api/workstations/${id}/metrics`);
}

export function wakeWorkstation(id: number): Promise<{ sent: boolean }> {
  return request<{ sent: boolean }>(`/api/workstations/${id}/wake`, { method: "POST" });
}

export type AgentCommand = "restart" | "shutdown";

/** Admin-only (P2-8). Queued, not immediate — delivered on the Agent's next heartbeat (up to ~5s). */
export function sendAgentCommand(id: number, command: AgentCommand): Promise<{ queued: boolean; commandLogId: number }> {
  return request<{ queued: boolean; commandLogId: number }>(`/api/workstations/${id}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
  });
}

/**
 * P3-6 admin gate. Takes a machine out of / back into the render pool without
 * touching `enabled` — monitoring, VNC and Wake-on-LAN keep working either way.
 * The scheduler skips a disabled worker on its next tick; a job already running
 * there is left to finish rather than being killed mid-encode.
 */
export function setWorkstationJobsEnabled(id: number, jobsEnabled: boolean): Promise<Workstation> {
  return request<Workstation>(`/api/workstations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobs_enabled: jobsEnabled }),
  });
}

export interface CreateWorkstationInput {
  name: string;
  hostname: string;
  ip: string;
  mac_address: string;
  vnc_port: number;
  location?: string;
}

export function createWorkstation(input: CreateWorkstationInput): Promise<Workstation> {
  return request<Workstation>("/api/workstations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
