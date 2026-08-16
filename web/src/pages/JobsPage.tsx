import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { cancelJob, createJob, listJobs, retryJob } from "../api/jobs";
import { listWorkstations } from "../api/workstations";
import type { Job, JobStatus } from "../types/job";

const POLL_MS = 3000;

const STATUS_CLASS: Record<JobStatus, string> = {
  QUEUED: "status-connecting",
  ASSIGNED: "status-connecting",
  RUNNING: "status-connected",
  PAUSED: "status-connecting",
  COMPLETED: "status-connected",
  FAILED: "status-disconnected",
  CANCELLED: "status-disconnected",
};

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [workerNames, setWorkerNames] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    listWorkstations()
      .then((list) => setWorkerNames(new Map(list.map((w) => [w.id, w.name]))))
      .catch(() => {
        // Non-fatal — jobs list still works, just shows worker ids instead of names.
      });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const result = await listJobs();
        if (!cancelled) {
          setJobs(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleCreateTestJob() {
    setCreating(true);
    setActionError(null);
    try {
      await createJob({ type: "test", input: JSON.stringify({ seconds: 10 }) });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleCancel(id: number) {
    setActionError(null);
    try {
      await cancelJob(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRetry(id: number) {
    setActionError(null);
    try {
      await retryJob(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  const CANCELLABLE = new Set<JobStatus>(["QUEUED", "ASSIGNED", "RUNNING"]);

  return (
    <div className="app">
      <header className="header remote-header">
        <div>
          <Link className="back-link" to="/">
            &larr; WORKSTATIONS
          </Link>
          <h1>JOBS</h1>
        </div>
        <div className="remote-toolbar">
          <button className="btn btn-primary" onClick={handleCreateTestJob} disabled={creating}>
            {creating ? "ĐANG TẠO..." : "+ TEST JOB (10s)"}
          </button>
        </div>
      </header>

      {error && <div className="error">Không kết nối được backend: {error}</div>}
      {actionError && <div className="error">{actionError}</div>}

      {jobs === null && !error && <div className="empty">Đang tải...</div>}
      {jobs !== null && jobs.length === 0 && (
        <div className="empty">Chưa có job nào — bấm "+ TEST JOB" để thử.</div>
      )}

      {jobs !== null && jobs.length > 0 && (
        <div className="jobs-list">
          {jobs.map((job) => (
            <div className="job-row" key={job.id}>
              <div className="job-main">
                <span className="job-id">#{job.id}</span>
                <span className="job-type">{job.type}</span>
                <span className={`status-pill ${STATUS_CLASS[job.status]}`}>{job.status}</span>
                {job.priority !== 0 && <span className="job-priority">ưu tiên {job.priority}</span>}
                {job.depends_on !== null && <span className="job-priority">chờ #{job.depends_on}</span>}
                {job.retry_count > 0 && <span className="job-priority">lần thử {job.retry_count + 1}</span>}
              </div>

              <div className="metric-bar job-progress-bar">
                <div className="metric-bar-fill" style={{ width: `${job.progress}%` }} />
              </div>

              <div className="job-meta">
                <span>
                  {job.worker_id !== null
                    ? `Máy: ${workerNames.get(job.worker_id) ?? `#${job.worker_id}`}${job.gpu_slot !== null ? ` (GPU ${job.gpu_slot})` : ""}`
                    : "Chưa gán máy"}
                </span>
                <span>{job.progress}%</span>
              </div>

              {job.error && <div className="job-error">{job.error}</div>}

              <div className="job-actions">
                {CANCELLABLE.has(job.status) && (
                  <button className="btn" onClick={() => handleCancel(job.id)}>
                    HỦY
                  </button>
                )}
                {job.status === "FAILED" && (
                  <button className="btn" onClick={() => handleRetry(job.id)}>
                    THỬ LẠI
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
