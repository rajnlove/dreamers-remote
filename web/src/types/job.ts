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
}
