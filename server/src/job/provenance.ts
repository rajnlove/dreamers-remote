import { ValidationError } from "../workstation/errors.js";

// Where a job came from. This is descriptive AUDIT metadata only and is
// never an authorization input: the submitting website's own RBAC stays
// authoritative for who may submit what, and everything here arrives
// from a caller that already passed that check. Treating any of it as a
// permission would let a caller grant itself "website production"
// standing by simply claiming it in the request body.
export const JOB_ORIGINS = [
  "website_shot_version",
  "website_project_upload",
  "upload_test",
  "admin_manual",
  "internal_test",
] as const;
export type JobOrigin = (typeof JOB_ORIGINS)[number];

// Website metadata carried alongside a job so the Job Engine can answer
// "where did this come from, and who sent it" without querying the
// website. Every field is optional: a website upload that isn't tied to
// a shot/version has no shot_code, and the public upload portal has no
// project at all — a missing field means "the submitter didn't have
// this", not "invalid". `job_id`/`job_name` are the *website's* own
// identifiers, unrelated to the engine's `jobs.id`.
export interface JobProvenance {
  project_id: string | null;
  project_name: string | null;
  job_id: string | null;
  job_name: string | null;
  shot_id: string | null;
  shot_code: string | null;
  version_id: string | null;
  version_no: number | null;
  uploaded_by_user_id: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string | null;
}

const TEXT_FIELDS = [
  "project_id",
  "project_name",
  "job_id",
  "job_name",
  "shot_id",
  "shot_code",
  "version_id",
  "uploaded_by_user_id",
  "uploaded_by_name",
] as const;

// Long enough for real project/shot names, short enough that provenance
// can't be used to smuggle a payload into the jobs table.
const MAX_TEXT_LENGTH = 200;

export function isJobOrigin(value: unknown): value is JobOrigin {
  return typeof value === "string" && (JOB_ORIGINS as readonly string[]).includes(value);
}

function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ValidationError(`provenance.${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new ValidationError(`provenance.${field} must be at most ${MAX_TEXT_LENGTH} characters`);
  }
  return trimmed;
}

export function validateOrigin(value: unknown): JobOrigin | null {
  if (value === undefined || value === null) return null;
  if (!isJobOrigin(value)) {
    throw new ValidationError(`origin must be one of: ${JOB_ORIGINS.join(", ")}`);
  }
  return value;
}

export function validateProvenance(value: unknown): JobProvenance | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("provenance must be an object");
  }
  const raw = value as Record<string, unknown>;

  const result: JobProvenance = {
    project_id: null,
    project_name: null,
    job_id: null,
    job_name: null,
    shot_id: null,
    shot_code: null,
    version_id: null,
    version_no: null,
    uploaded_by_user_id: null,
    uploaded_by_name: null,
    uploaded_at: null,
  };
  for (const field of TEXT_FIELDS) {
    result[field] = optionalText(raw[field], field);
  }

  if (raw.version_no !== undefined && raw.version_no !== null && raw.version_no !== "") {
    const versionNo = Number(raw.version_no);
    if (!Number.isInteger(versionNo) || versionNo < 0) {
      throw new ValidationError("provenance.version_no must be a non-negative integer");
    }
    result.version_no = versionNo;
  }

  if (raw.uploaded_at !== undefined && raw.uploaded_at !== null && raw.uploaded_at !== "") {
    if (typeof raw.uploaded_at !== "string") {
      throw new ValidationError("provenance.uploaded_at must be an ISO 8601 date string");
    }
    const parsed = new Date(raw.uploaded_at);
    if (Number.isNaN(parsed.getTime())) {
      throw new ValidationError("provenance.uploaded_at must be an ISO 8601 date string");
    }
    // Normalized so every stored timestamp compares/sorts the same way
    // as the engine's own (always ISO-8601 UTC), whatever offset format
    // the submitting website happened to use.
    result.uploaded_at = parsed.toISOString();
  }

  // All-null provenance is stored as no provenance at all, so a caller
  // sending an empty object doesn't leave a row looking like it carries
  // website metadata when it carries none.
  const hasAnyValue = Object.values(result).some((entry) => entry !== null);
  return hasAnyValue ? result : null;
}
