import type { Workstation, WorkstationStatus } from "../types/workstation";
import { API_BASE_URL } from "./config";

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
