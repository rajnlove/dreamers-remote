import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../config/env.js";

// Re-exported so callers that need e.g. `Database.SqliteError` (see
// workstation/repository.ts) import the native addon from here instead
// of adding their own separate `from "better-sqlite3"` import — with
// ESM's CJS-interop for native addons, two independent import sites for
// the same native module have been observed to double-register the
// addon's process cleanup hook, crashing on teardown (Node asserting
// `RemoveEnvironmentCleanupHook`'s env != nullptr). One import site here
// avoids the whole question.
export { Database };

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

// Phase 2 (P2-8): V1 has exactly one (admin) account and no registration
// endpoint (see seedAdminUser), so this can't be false yet — it exists to
// gate restart/shutdown separately from plain requireAuth ahead of a real
// M7 role system, not because it does anything today. DEFAULT 1 so SQLite
// backfills the existing seeded admin row, not just new ones.
ensureColumn("users", "is_admin", "INTEGER NOT NULL DEFAULT 1");

// Phase 2 (P2-8): audit trail for Agent commands specifically — not the
// general M8 audit log (login, wake, CRUD), which doesn't exist yet.
// status: "pending" (queued, not yet delivered) -> "sent" (included in a
// heartbeat response) -> "ok" | "failed" (Agent reported back), or
// "superseded" (replaced by a newer command before the Agent picked it
// up — see queueCommand in agent/commands.ts).
db.exec(`
  CREATE TABLE IF NOT EXISTS command_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workstation_id INTEGER NOT NULL REFERENCES workstations(id),
    command TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    issued_by INTEGER NOT NULL REFERENCES users(id),
    issued_at TEXT NOT NULL,
    sent_at TEXT,
    completed_at TEXT,
    detail TEXT
  )
`);

// Phase 3 (P3-1): job data model. No scheduler yet (P3-3) — jobs just
// sit QUEUED after creation for now. worker_id/gpu_slot stay unused
// until P3-2/P3-3 assign them. status: QUEUED -> ASSIGNED -> RUNNING ->
// COMPLETED | FAILED | CANCELLED, with PAUSED as an optional detour
// from RUNNING (see docs/ROADMAP.md's Phase 3 section for the full
// state model). input/output are free-form JSON strings — schema
// varies per job `type`, not enforced at the DB layer.
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'QUEUED',
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    worker_id INTEGER REFERENCES workstations(id),
    gpu_slot INTEGER,
    progress INTEGER NOT NULL DEFAULT 0,
    input TEXT,
    output TEXT,
    error TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0
  )
`);

// Phase 3 (P3-6): basic single-dependency support — job B waits for job
// A. Not a full DAG (no multi-parent, no diamond dependencies) — one
// optional predecessor is what "basic ... dependency" in the P3-6
// milestone scope calls for; a real DAG is a later polish item if a
// concrete workflow needs it.
ensureColumn("jobs", "depends_on", "INTEGER REFERENCES jobs(id)");

// Phase 3 (P3-6): manual admin gate on job assignment — covers the
// DISABLED case from MASTER_PROJECT_SPEC.md §11's 5-state model
// (AVAILABLE/BUSY/DISABLED/DEDICATED_WORKER/INTERACTIVE). BUSY is
// derived at query time (does the worker have a free unit right now?),
// not stored. DEDICATED_WORKER/INTERACTIVE as distinct states are
// deliberately deferred — this boolean plus the CPU/RAM/GPU usage
// thresholds in job/scheduler.ts cover "don't assign more work here"
// for now; a real state machine is a later refinement once a concrete
// workflow needs to distinguish those cases from plain disabled.
ensureColumn("workstations", "jobs_enabled", "INTEGER NOT NULL DEFAULT 1");

// Phase 3 (P3-8): software version compatibility, mechanism only — no
// real software checks exist yet (nothing to check until Phase 4/5
// installs real tools like Houdini/FFmpeg/Octane). A job can optionally
// require exact software versions (JSON string, name -> version); the
// scheduler won't assign it to a worker whose reported
// software_versions doesn't match every entry. Null means no
// requirement, same as depends_on's null-means-none convention.
ensureColumn("jobs", "required_software", "TEXT");
