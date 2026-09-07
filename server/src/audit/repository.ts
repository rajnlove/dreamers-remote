import type { Request } from "express";
import { db } from "../database/db.js";
import { getUserById } from "../auth/users.js";
import type { AuditAction } from "./actions.js";

export { AUDIT_ACTIONS, isAuditAction, type AuditAction } from "./actions.js";

export interface AuditEntry {
  id: number;
  at: string;
  action: AuditAction;
  actor_user_id: number | null;
  actor_username: string | null;
  target_type: string | null;
  target_id: number | null;
  target_label: string | null;
  ip: string | null;
  detail: string | null;
}

export interface RecordAuditInput {
  action: AuditAction;
  // Omitted for events with no authenticated user (a failed login). When a
  // request is given, the username is resolved from it and snapshotted.
  req?: Request;
  actorUsername?: string;
  targetType?: "workstation" | "user" | "job";
  targetId?: number;
  targetLabel?: string;
  // Small, non-sensitive context only — never credentials, keystrokes or
  // clipboard content (docs/ROADMAP.md M8, docs/SECURITY.md).
  detail?: Record<string, unknown>;
}

// Express sees the reverse proxy / container network, so req.ip is often the
// gateway rather than the artist's machine. X-Forwarded-For's FIRST entry is
// the original client where a proxy sets it. Untrusted input either way —
// stored for correlation only, never used for authorization.
function clientIp(req: Request | undefined): string | null {
  if (!req) return null;
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(",")[0]?.trim();
  return (first || req.ip || null)?.slice(0, 64) ?? null;
}

const insert = db.prepare(`
  INSERT INTO audit_log (at, action, actor_user_id, actor_username, target_type, target_id, target_label, ip, detail)
  VALUES (@at, @action, @actor_user_id, @actor_username, @target_type, @target_id, @target_label, @ip, @detail)
`);

/**
 * Fire-and-forget: auditing must never be able to fail the action it
 * describes. A wake that worked but whose log row could not be written is
 * still a successful wake — the alternative (500 on a completed side effect)
 * is strictly worse for the operator. Failures are reported to stderr so a
 * broken audit trail is visible in container logs rather than silent.
 */
export function recordAudit(input: RecordAuditInput): void {
  try {
    const userId = input.req?.session?.userId ?? null;
    const username = input.actorUsername ?? (userId ? (getUserById(userId)?.username ?? null) : null);
    insert.run({
      at: new Date().toISOString(),
      action: input.action,
      actor_user_id: userId,
      actor_username: username,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      target_label: input.targetLabel ?? null,
      ip: clientIp(input.req),
      detail: input.detail ? JSON.stringify(input.detail) : null,
    });
  } catch (err) {
    console.error("Failed to write audit entry", input.action, err);
  }
}

export interface ListAuditQuery {
  limit: number;
  offset: number;
  action?: AuditAction;
  targetId?: number;
}

export interface ListAuditResult {
  entries: AuditEntry[];
  total: number;
}

// Newest first. `total` is returned alongside the page so the UI can show
// "showing N of M" and know whether another page exists without a second
// round trip.
export function listAudit(query: ListAuditQuery): ListAuditResult {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (query.action) {
    where.push("action = @action");
    params.action = query.action;
  }
  if (query.targetId !== undefined) {
    where.push("target_id = @targetId");
    params.targetId = query.targetId;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM audit_log ${clause}`).get(params) as { n: number }
  ).n;
  const entries = db
    .prepare(
      `SELECT * FROM audit_log ${clause} ORDER BY at DESC, id DESC LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: query.limit, offset: query.offset }) as AuditEntry[];
  return { entries, total };
}

/**
 * M8 has no retention policy of its own — this exists so an operator can
 * trim the table when it grows, and so tests can reset between runs. Kept
 * out of any scheduled job deliberately: silently deleting audit history on
 * a timer is the kind of thing an audit log exists to prevent.
 */
export function deleteAuditBefore(isoTimestamp: string): number {
  return db.prepare("DELETE FROM audit_log WHERE at < ?").run(isoTimestamp).changes;
}
