import type { Workstation, WorkstationStatus } from "../types/workstation";

// LAN-only V1: the dashboard talks to the backend's known address directly.
// Override at build time with VITE_API_BASE_URL for other deployments.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://192.29.11.92:8080";

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) {
    throw new Error(`Request to ${path} failed: ${res.status}`);
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
