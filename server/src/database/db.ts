import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../config/env.js";

mkdirSync(dirname(env.databaseFile), { recursive: true });

export const db = new Database(env.databaseFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS workstations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    hostname TEXT NOT NULL,
    ip TEXT NOT NULL,
    mac_address TEXT NOT NULL,
    vnc_port INTEGER NOT NULL DEFAULT 5900,
    location TEXT,
    description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

// Phase 2 (P2-5): columns added to an already-deployed table need a real
// migration, not just CREATE TABLE IF NOT EXISTS (which only affects
// brand-new databases). Nullable + idempotent — safe to run on every boot.
function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("workstations", "agent_id", "TEXT");
ensureColumn("workstations", "agent_credential_hash", "TEXT");
ensureColumn("workstations", "last_seen", "TEXT");
ensureColumn("workstations", "agent_version", "TEXT");
ensureColumn("workstations", "os", "TEXT");

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_workstations_agent_id
    ON workstations(agent_id) WHERE agent_id IS NOT NULL
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_registration_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workstation_id INTEGER NOT NULL REFERENCES workstations(id),
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  )
`);
