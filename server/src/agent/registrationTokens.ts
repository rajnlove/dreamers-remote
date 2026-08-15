import { db } from "../database/db.js";
import { generateSecret, hashSecret } from "./crypto.js";
import { ValidationError } from "../workstation/errors.js";

const TOKEN_TTL_MINUTES = 15;

interface TokenRow {
  id: number;
  workstation_id: number;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface IssuedToken {
  token: string;
  expiresAt: string;
}

/** Admin-only (see /api/workstations/:id/agent-token) — the plaintext token is returned once and never retrievable again. */
export function createRegistrationToken(workstationId: number): IssuedToken {
  const token = generateSecret();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MINUTES * 60_000).toISOString();

  db.prepare(
    `INSERT INTO agent_registration_tokens (workstation_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(workstationId, hashSecret(token), expiresAt, now.toISOString());

  return { token, expiresAt };
}

/**
 * Validates and consumes a registration token, returning the workstation id
 * it was issued for. Throws ValidationError if the token is unknown,
 * already used, or expired — the /register route maps this to a 400, same
 * as other input validation in this codebase.
 */
export function consumeRegistrationToken(token: string): number {
  const row = db
    .prepare(`SELECT * FROM agent_registration_tokens WHERE token_hash = ? AND used_at IS NULL`)
    .get(hashSecret(token)) as TokenRow | undefined;

  if (!row) {
    throw new ValidationError("Invalid or already-used registration token");
  }

  if (new Date(row.expires_at) < new Date()) {
    throw new ValidationError("Registration token has expired");
  }

  db.prepare(`UPDATE agent_registration_tokens SET used_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    row.id,
  );

  return row.workstation_id;
}
