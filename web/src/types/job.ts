export type JobStatus = "QUEUED" | "ASSIGNED" | "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED" | "CANCELLED";

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
}
