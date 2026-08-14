import Database from "better-sqlite3";
import { db } from "../database/db.js";
import { ConflictError } from "./errors.js";
import type { Workstation, WorkstationInput, WorkstationUpdateInput } from "./types.js";

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
}

function rowToWorkstation(row: WorkstationRow): Workstation {
  return { ...row, enabled: row.enabled === 1 };
}

export function listWorkstations(): Workstation[] {
  const rows = db.prepare("SELECT * FROM workstations ORDER BY name").all() as WorkstationRow[];
  return rows.map(rowToWorkstation);
}

export function getWorkstation(id: number): Workstation | undefined {
  const row = db.prepare("SELECT * FROM workstations WHERE id = ?").get(id) as WorkstationRow | undefined;
  return row ? rowToWorkstation(row) : undefined;
}

export function createWorkstation(input: WorkstationInput): Workstation {
  const now = new Date().toISOString();
  let result;
  try {
    result = db
      .prepare(
        `INSERT INTO workstations
           (name, hostname, ip, mac_address, vnc_port, location, description, enabled, created_at, updated_at)
         VALUES (@name, @hostname, @ip, @mac_address, @vnc_port, @location, @description, @enabled, @created_at, @updated_at)`,
      )
      .run({
        ...input,
        enabled: input.enabled ? 1 : 0,
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
             enabled = @enabled, updated_at = @updated_at
         WHERE id = @id`,
    ).run({
      ...merged,
      enabled: merged.enabled ? 1 : 0,
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
