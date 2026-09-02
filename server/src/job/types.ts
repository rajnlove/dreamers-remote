// See docs/MASTER_PROJECT_SPEC.md §14 and docs/ROADMAP.md's Phase 3
// section for the full state model this is working toward.
export const JOB_STATUSES = [
  "QUEUED",
  "ASSIGNED",
  "RUNNING",
  "PAUSED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

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
  // P3-6: basic single-dependency — this job won't be scheduled until
  // the referenced job is COMPLETED. Null means no dependency.
  depends_on: number | null;
  // P3-8: software version compatibility, mechanism only — JSON string
  // of { [softwareName]: requiredVersion }, exact-match. Null means no
  // requirement. Stored as a JSON string like `input`/`output` since
  // it's a free-form set of key/value pairs, not something queried by
  // column.
  required_software: string | null;
  // P4-2: generic progress-detail fields a worker may optionally report
  // alongside `progress` -- null if this job type never reports them.
  fps: number | null;
  eta_seconds: number | null;
  // P4-3H: last time this specific job's execution was confirmed alive
  // (startJob()/updateJobProgress()) -- see failStaleRunningJobs(). Null
  // until the job has actually started.
  last_progress_at: string | null;
}

export interface JobInput {
  type: string;
  priority: number;
  input: string | null;
  depends_on: number | null;
  required_software: Record<string, string> | null;
}
