import { db } from "../database/db.js";
import { hashSecret, secretMatchesHash } from "./crypto.js";

interface AgentAuthRow {
  id: number;
  agent_credential_hash: string | null;
}

/** Pairs a workstation with an agent for the first time (or re-pairs after a reinstall) — see /api/agent/register. */
export function pairAgent(
  workstationId: number,
  agentId: string,
  credential: string,
  os: string | undefined,
  agentVersion: string | undefined,
): void {
  db.prepare(
    `UPDATE workstations
       SET agent_id = ?, agent_credential_hash = ?, os = ?, agent_version = ?, last_seen = ?
       WHERE id = ?`,
  ).run(agentId, hashSecret(credential), os ?? null, agentVersion ?? null, new Date().toISOString(), workstationId);
}

/** Returns the workstation id the credential belongs to, or null if the agent is unknown or the credential is wrong — deliberately not distinguishing the two, to avoid leaking which agent ids exist. */
export function verifyAgentCredential(agentId: string, credential: string): number | null {
  const row = db
    .prepare(`SELECT id, agent_credential_hash FROM workstations WHERE agent_id = ?`)
    .get(agentId) as AgentAuthRow | undefined;

  if (!row || !row.agent_credential_hash) return null;
  if (!secretMatchesHash(credential, row.agent_credential_hash)) return null;

  return row.id;
}

export function recordHeartbeat(workstationId: number, agentVersion?: string, os?: string): void {
  db.prepare(
    `UPDATE workstations
       SET last_seen = ?, agent_version = COALESCE(?, agent_version), os = COALESCE(?, os)
       WHERE id = ?`,
  ).run(new Date().toISOString(), agentVersion ?? null, os ?? null, workstationId);
}
