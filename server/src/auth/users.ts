import { db } from "../database/db.js";
import { hashPassword } from "./password.js";

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  is_admin: number;
  created_at: string;
}

export function getUserByUsername(username: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
}

export function getUserById(id: number): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

// V1 has exactly one admin account, seeded from env vars on first boot —
// no registration endpoint. If a user already exists, this is a no-op.
export async function seedAdminUser(username: string, password: string): Promise<void> {
  const { count } = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  if (count > 0) return;

  const passwordHash = await hashPassword(password);
  db.prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)").run(
    username,
    passwordHash,
    new Date().toISOString(),
  );
  console.log(`Seeded admin user "${username}"`);
}

// P4-5: a second, non-admin account for the PHP Projects site to log in
// as (POST /api/login, same as any human user) and reuse the session
// cookie to call POST /api/jobs -- the "service account" approach the
// user picked over adding a whole separate API-key auth path. Deliberately
// still just `requireAuth`, not `requireAdmin` (POST /api/jobs only needs
// the former) -- `is_admin = 0` so this account can never hit an
// admin-gated route (restart/shutdown, workstation CRUD) even if PHP's
// credential ever leaked. Idempotent per-username (not "any user
// exists" like seedAdminUser above) so it coexists with the single admin
// account and re-runs safely on every boot without duplicating or
// resetting the password of an already-created account.
export async function seedServiceUser(username: string, password: string): Promise<void> {
  if (getUserByUsername(username)) return;

  const passwordHash = await hashPassword(password);
  db.prepare(
    "INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, 0, ?)",
  ).run(username, passwordHash, new Date().toISOString());
  console.log(`Seeded service account "${username}" (non-admin)`);
}
