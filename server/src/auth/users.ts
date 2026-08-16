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
