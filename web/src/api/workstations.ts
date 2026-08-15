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
