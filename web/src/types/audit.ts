// Mirrors server/src/audit/actions.ts. The page fetches the live list from
// /api/audit/actions for its filter dropdown, so a server-side addition
// still filters correctly here — this union only types the label map, and a
// missing entry falls back to the raw action string rather than breaking.
export type AuditAction =
  | "login.success"
  | "login.failure"
  | "logout"
  | "remote.start"
  | "remote.end"
  | "workstation.create"
  | "workstation.update"
  | "workstation.delete"
  | "workstation.wake"
  | "workstation.command"
  | "workstation.agent_token";

export interface AuditEntry {
  id: number;
  at: string;
  action: AuditAction;
  actor_user_id: number | null;
  // Snapshot taken when the row was written — still correct after the user
  // or workstation it names is renamed or deleted.
  actor_username: string | null;
  target_type: string | null;
  target_id: number | null;
  target_label: string | null;
  ip: string | null;
  // JSON string of small non-sensitive context, or null. Parsed for display
  // only; never trusted to have a particular shape.
  detail: string | null;
}

export interface AuditPage {
  entries: AuditEntry[];
  total: number;
}
