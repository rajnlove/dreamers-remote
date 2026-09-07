import type { AuditAction, AuditPage } from "../types/audit";
import { API_BASE_URL } from "./config";

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { credentials: "include" });
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

export interface ListAuditParams {
  limit?: number;
  offset?: number;
  action?: AuditAction | "";
  targetId?: number;
}

/** M8. Admin-only server-side; a non-admin gets 403 and the page says so. */
export function listAudit(params: ListAuditParams = {}): Promise<AuditPage> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  if (params.action) query.set("action", params.action);
  if (params.targetId !== undefined) query.set("targetId", String(params.targetId));
  const suffix = query.toString();
  return request<AuditPage>(`/api/audit${suffix ? `?${suffix}` : ""}`);
}

/** Filter options come from the server so the dropdown can't drift from the enum. */
export function listAuditActions(): Promise<AuditAction[]> {
  return request<AuditAction[]>("/api/audit/actions");
}
