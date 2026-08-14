import type { Workstation, WorkstationStatus } from "../types/workstation";
import { API_BASE_URL } from "./config";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, init);
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

export function getWorkstationsStatus(): Promise<WorkstationStatus[]> {
  return request<WorkstationStatus[]>("/api/workstations/status");
}

export function getWorkstation(id: number): Promise<Workstation> {
  return request<Workstation>(`/api/workstations/${id}`);
}

export function wakeWorkstation(id: number): Promise<{ sent: boolean }> {
  return request<{ sent: boolean }>(`/api/workstations/${id}/wake`, { method: "POST" });
}
