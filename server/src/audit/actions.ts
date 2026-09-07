// M8. Kept in its own module, deliberately free of any DB import: the API
// validates a query parameter against this list and the tests exercise the
// guard, neither of which should have to open SQLite (the native binding
// does not load on every dev machine — see repository.test.ts).
//
// A closed set, not free-form strings: the UI filters and translates by
// action, so a typo at a call site would otherwise create a silently
// unfilterable event. Named `<subject>.<verb>` so related events group when
// sorted. Add here first, then handle the new key in the web page's label map.
export const AUDIT_ACTIONS = [
  "login.success",
  "login.failure",
  "logout",
  "remote.start",
  "remote.end",
  "workstation.create",
  "workstation.update",
  "workstation.delete",
  "workstation.wake",
  "workstation.command",
  "workstation.agent_token",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === "string" && (AUDIT_ACTIONS as readonly string[]).includes(value);
}
