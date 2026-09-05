import { ValidationError } from "../workstation/errors.js";
import type { JobInput } from "./types.js";
import { validateFfmpegInput } from "./ffmpegValidation.js";
import { validateTopazInput } from "./topazValidation.js";
import { validateOrigin, validateProvenance } from "./provenance.js";

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

  // P4-2: known job types get a stricter shape check on top of the
  // generic "must be a string" rule above -- re-stringified so the
  // stored `input` is always the validated/normalized shape, not
  // whatever the caller happened to send.
  if (b.type === "ffmpeg" && input !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      throw new ValidationError("input must be valid JSON for an ffmpeg job");
    }
    input = JSON.stringify(validateFfmpegInput(parsed));
  }

  // P4-4: same stricter-shape-check pattern as "ffmpeg" above.
  if (b.type === "topaz" && input !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      throw new ValidationError("input must be valid JSON for a topaz job");
    }
    input = JSON.stringify(validateTopazInput(parsed));
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

  // P3-8: mechanism only — an object of string -> string, validated for
  // shape here; whether any worker actually satisfies it is the
  // scheduler's job (job/scheduler.ts), not this function's.
  let requiredSoftware: Record<string, string> | null = null;
  if (b.required_software !== undefined && b.required_software !== null) {
    if (
      typeof b.required_software !== "object" ||
      Array.isArray(b.required_software)
    ) {
      throw new ValidationError("required_software must be an object of software name -> version");
    }
    const entries = Object.entries(b.required_software as Record<string, unknown>);
    for (const [name, version] of entries) {
      if (typeof version !== "string" || version.trim().length === 0) {
        throw new ValidationError(`required_software["${name}"] must be a non-empty string`);
      }
    }
    requiredSoftware = Object.fromEntries(entries) as Record<string, string>;
  }

  // Provenance/audit metadata: shape-checked here, never consulted for
  // access control (see job/provenance.ts). Absent is always valid --
  // an older client, an internal script, or any caller that simply
  // doesn't know its own origin still creates a job, it just reads as
  // Legacy/Unknown afterwards.
  const origin = validateOrigin(b.origin);
  const provenance = validateProvenance(b.provenance);

  return {
    type: b.type.trim(),
    priority,
    input,
    depends_on: dependsOn,
    required_software: requiredSoftware,
    origin,
    provenance,
  };
}
