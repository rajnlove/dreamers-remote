import { db } from "../database/db.js";

// Structured whitelist only — never arbitrary shell. See docs/SECURITY.md.
export const AGENT_COMMANDS = ["restart", "shutdown"] as const;
export type AgentCommand = (typeof AGENT_COMMANDS)[number];

export function isAgentCommand(value: unknown): value is AgentCommand {
  return typeof value === "string" && (AGENT_COMMANDS as readonly string[]).includes(value);
}

interface PendingCommand {
  commandLogId: number;
  command: AgentCommand;
}

// In-memory, keyed by workstationId — same precedent as metricsCache.ts.
// Delivery rides the existing heartbeat channel (Agent already calls out
// every 5s; no inbound listener on the Agent, no new poll endpoint), so a
// command only needs to survive until the next heartbeat, not a server
// restart.
const pendingByWorkstationId = new Map<number, PendingCommand>();

export function queueCommand(workstationId: number, command: AgentCommand, issuedBy: number): number {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO command_log (workstation_id, command, status, issued_by, issued_at)
       VALUES (?, ?, 'pending', ?, ?)`,
    )
    .run(workstationId, command, issuedBy, new Date().toISOString());

  const commandLogId = Number(lastInsertRowid);
  pendingByWorkstationId.set(workstationId, { commandLogId, command });
  return commandLogId;
}

// Called from the heartbeat handler. Dequeues (a command is delivered at
// most once) and marks it "sent" — final status comes from
// POST /api/agent/command-result.
export function takePendingCommand(workstationId: number): AgentCommand | null {
  const pending = pendingByWorkstationId.get(workstationId);
  if (!pending) return null;

  pendingByWorkstationId.delete(workstationId);
  db.prepare(`UPDATE command_log SET status = 'sent', sent_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    pending.commandLogId,
  );
  return pending.command;
}

export function recordCommandResult(workstationId: number, command: AgentCommand, ok: boolean, detail?: string): void {
  db.prepare(
    `UPDATE command_log
       SET status = ?, completed_at = ?, detail = ?
       WHERE id = (
         SELECT id FROM command_log
         WHERE workstation_id = ? AND command = ? AND status = 'sent'
         ORDER BY id DESC LIMIT 1
       )`,
  ).run(ok ? "ok" : "failed", new Date().toISOString(), detail ?? null, workstationId, command);
}
