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
}

export interface JobInput {
  type: string;
  priority: number;
  input: string | null;
}
