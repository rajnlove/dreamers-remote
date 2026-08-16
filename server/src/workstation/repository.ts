import { Database, db } from "../database/db.js";
import { ConflictError } from "./errors.js";
import type { Workstation, WorkstationInput, WorkstationUpdateInput } from "./types.js";

// Explicit column list, not SELECT * — agent_credential_hash lives in the
// same table (see database/db.ts) but must never leave the server, not
// even hashed, since there's no reason for a dashboard client to see it.
const PUBLIC_COLUMNS = `
  id, name, hostname, ip, mac_address, vnc_port, location, description,
  enabled, created_at, updated_at, agent_id, last_seen, agent_version, os,
  jobs_enabled
`;

interface WorkstationRow {
  id: number;
  name: string;
  hostname: string;
  ip: string;
  mac_address: string;
  vnc_port: number;
  location: string | null;
  description: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
  agent_id: string | null;
  last_seen: string | null;
  agent_version: string | null;
  os: string | null;
  jobs_enabled: number;
}

function rowToWorkstation(row: WorkstationRow): Workstation {
  return { ...row, enabled: row.enabled === 1, jobs_enabled: row.jobs_enabled === 1 };
}

export function listWorkstations(): Workstation[] {
  const rows = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM workstations ORDER BY name`).all() as WorkstationRow[];
  return rows.map(rowToWorkstation);
}

export function getWorkstation(id: number): Workstation | undefined {
  const row = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM workstations WHERE id = ?`).get(id) as
    | WorkstationRow
    | undefined;
  return row ? rowToWorkstation(row) : undefined;
}

export function createWorkstation(input: WorkstationInput): Workstation {
  const now = new Date().toISOString();
  let result;
  try {
    result = db
      .prepare(
        `INSERT INTO workstations
           (name, hostname, ip, mac_address, vnc_port, location, description, enabled, jobs_enabled, created_at, updated_at)
         VALUES (@name, @hostname, @ip, @mac_address, @vnc_port, @location, @description, @enabled, @jobs_enabled, @created_at, @updated_at)`,
      )
      .run({
        ...input,
        enabled: input.enabled ? 1 : 0,
        jobs_enabled: input.jobs_enabled ? 1 : 0,
        created_at: now,
        updated_at: now,
      });
  } catch (err) {
    if (err instanceof Database.SqliteError && err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new ConflictError(`Workstation with name "${input.name}" already exists`);
    }
    throw err;
  }
  return getWorkstation(Number(result.lastInsertRowid))!;
}

export function updateWorkstation(id: number, input: WorkstationUpdateInput): Workstation | undefined {
  const existing = getWorkstation(id);
  if (!existing) return undefined;

  const merged: Workstation = { ...existing, ...input };
  const now = new Date().toISOString();
  try {
    db.prepare(
      `UPDATE workstations
         SET name = @name, hostname = @hostname, ip = @ip, mac_address = @mac_address,
             vnc_port = @vnc_port, location = @location, description = @description,
             enabled = @enabled, jobs_enabled = @jobs_enabled, updated_at = @updated_at
         WHERE id = @id`,
    ).run({
      id: merged.id,
      name: merged.name,
      hostname: merged.hostname,
      ip: merged.ip,
      mac_address: merged.mac_address,
      vnc_port: merged.vnc_port,
      location: merged.location,
      description: merged.description,
      enabled: merged.enabled ? 1 : 0,
      jobs_enabled: merged.jobs_enabled ? 1 : 0,
      updated_at: now,
    });
  } catch (err) {
    if (err instanceof Database.SqliteError && err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new ConflictError(`Workstation with name "${merged.name}" already exists`);
    }
    throw err;
  }
  return getWorkstation(id);
}

export function deleteWorkstation(id: number): boolean {
  const result = db.prepare("DELETE FROM workstations WHERE id = ?").run(id);
  return result.changes > 0;
}
