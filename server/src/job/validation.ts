import { ValidationError } from "../workstation/errors.js";
import type { JobInput } from "./types.js";

// P3-1: no whitelist of known job types yet — Phase 3 only ships a
// trivial built-in "test" type (P3-4); Phase 4/5 add real ones later.
// Reject empty/non-string, otherwise accept anything (mirrors how
// AGENT_COMMANDS whitelists a fixed enum, but job `type` is meant to be
// extensible, not a fixed set).
export function validateCreateInput(body: unknown): JobInput {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be an object");
  }
  const b = body as Record<string, unknown>;

  if (typeof b.type !== "string" || b.type.trim().length === 0) {
    throw new ValidationError("type is required and must be a non-empty string");
  }

  let priority = 0;
  if (b.priority !== undefined) {
    priority = Number(b.priority);
    if (!Number.isInteger(priority)) {
      throw new ValidationError("priority must be an integer");
    }
  }

  let input: string | null = null;
  if (b.input !== undefined && b.input !== null) {
    // Stored as-is (free-form, job-type-specific) — just require it be
    // JSON-serializable text, not a nested object we'd have to guess a
    // schema for.
    if (typeof b.input !== "string") {
      throw new ValidationError("input must be a string (JSON-encoded, job-type-specific)");
    }
    input = b.input;
  }

  // P3-6: format only (positive integer) — whether the referenced job
  // actually exists is checked in the route (api/jobs.ts), which is
  // where the rest of this codebase's "does this id exist" checks live
  // (throwing NotFoundError, not ValidationError).
  let dependsOn: number | null = null;
  if (b.depends_on !== undefined && b.depends_on !== null) {
    dependsOn = Number(b.depends_on);
    if (!Number.isInteger(dependsOn) || dependsOn <= 0) {
      throw new ValidationError("depends_on must be a positive integer");
    }
  }

  return { type: b.type.trim(), priority, input, depends_on: dependsOn };
}
