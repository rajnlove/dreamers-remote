export type JobStatus = "QUEUED" | "ASSIGNED" | "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED" | "CANCELLED";

// Where a job came from, as declared by whoever submitted it. Audit
// metadata only -- never a permission (see server/src/job/provenance.ts).
// A job created before this existed, or by a caller that doesn't send
// one, has origin null and renders as Legacy/Unknown.
export type JobOrigin =
  | "website_shot_version"
  | "website_project_upload"
  | "upload_test"
  | "admin_manual"
  | "internal_test";

// Parsed shape of Job.provenance (stored server-side as a JSON string).
// Every field is optional: a website upload with no shot has no
// shot_code, and the public portal has no project at all.
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

export interface Job {
  id: number;
  type: string;
  status: JobStatus;
  priority: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  worker_id: number | null;
  gpu_slot: number | null;
  progress: number;
  input: string | null;
  output: string | null;
  error: string | null;
  retry_count: number;
  depends_on: number | null;
  required_software: string | null;
  // Phase 4 (P4-2): only FFmpeg-style jobs report these -- null otherwise.
  fps: number | null;
  eta_seconds: number | null;
  // Provenance/audit. `provenance` is a JSON string of JobProvenance;
  // both are null for legacy jobs and for callers that don't send them.
  origin: JobOrigin | null;
  provenance: string | null;
  // Audit timeline, re-stamped per attempt by the engine. Older jobs
  // predate these columns and report null, which the UI shows as "—"
  // rather than inventing a time.
  engine_queued_at: string | null;
  assigned_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
}
