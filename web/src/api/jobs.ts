import type { Job } from "../types/job";
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

// DELETE /api/jobs/:id responds 204 with no body -- calling .json() on
// that (like the generic request<T> above does) throws a JSON parse
// error even on success, so this is its own helper rather than reusing
// request<T> with a throwaway type parameter.
async function requestVoid(path: string, init?: RequestInit): Promise<void> {
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
}

export function listJobs(): Promise<Job[]> {
  return request<Job[]>("/api/jobs");
}

export interface CreateJobInput {
  type: string;
  priority?: number;
  input?: string;
  depends_on?: number;
}

export function createJob(input: CreateJobInput): Promise<Job> {
  return request<Job>("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function cancelJob(id: number): Promise<Job> {
  return request<Job>(`/api/jobs/${id}/cancel`, { method: "POST" });
}

export function retryJob(id: number): Promise<Job> {
  return request<Job>(`/api/jobs/${id}/retry`, { method: "POST" });
}

// Admin-only server-side (requireAdmin) -- only succeeds once a job is
// terminal (COMPLETED/FAILED/CANCELLED); the server 409s otherwise.
export function deleteJob(id: number): Promise<void> {
  return requestVoid(`/api/jobs/${id}`, { method: "DELETE" });
}
