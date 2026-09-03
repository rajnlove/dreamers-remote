import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { cancelJob, createJob, listJobs, retryJob } from "../api/jobs";
import { getWorkstationsStatus, listWorkstations } from "../api/workstations";
import type { Job, JobStatus } from "../types/job";

import type { WorkstationStatus } from "../types/workstation";
import "./JobsPage.css";

const POLL_MS = 3000;
const TABS = ["All", "Running", "Pending", "Completed", "Failed", "Paused", "Cancelled"] as const;
type Tab = typeof TABS[number];
const LABEL: Record<JobStatus, Tab> = { QUEUED: "Pending", ASSIGNED: "Pending", RUNNING: "Running", COMPLETED: "Completed", FAILED: "Failed", PAUSED: "Paused", CANCELLED: "Cancelled" };
function sourceName(job: Job): string {
  try {
    const input = JSON.parse(job.input ?? "{}");
    return String(input.sourcePath ?? `${job.type} job #${job.id}`).split(/[\\/]/).pop() || `Job #${job.id}`;
  } catch { return `${job.type} job #${job.id}`; }
}
function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const value = Math.max(0, Math.round(seconds));
  return [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60].map(n => String(n).padStart(2, "0")).join(":");
}
function percent(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value)}%`;
}


export default function JobsPage({ username }: { username: string }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [workerNames, setWorkerNames] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [machines, setMachines] = useState<WorkstationStatus[] | null>(null);
  const [machineError, setMachineError] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("All");
  const [sort, setSort] = useState("priority");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    async function pollMachines() {
      try {
        const result = await getWorkstationsStatus();
        if (!cancelled) { setMachines(result); setMachineError(false); }
      } catch { if (!cancelled) setMachineError(true); }
    }
    void pollMachines();
    const timer = setInterval(pollMachines, 5000);
    return () => { cancelled = true; clearInterval(timer); };
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

  // Phase 4 (P4-2) demo: a real GPU-encoded FFmpeg job against a real
  // source clip on the TrueNAS share, so the job engine's progress/fps
  // reporting is visible on real work, not just the synthetic "test"
  // type's sleep loop. Requires FFMPEG_ALLOWED_ROOTS (server) and
  // allowed_paths.json (Agent) to already include this UNC root — see
  // docs/PROJECT_STATUS.md's Phase 4 section.
  const DEMO_SOURCE = "\\\\192.29.11.92\\web_data\\www\\Projects\\SOURCE\\A008C005_130101_R31Z.mov";
  async function handleCreateFfmpegDemoJob() {
    setCreating(true);
    setActionError(null);
    try {
      const outputPath = `\\\\192.29.11.92\\web_data\\www\\Projects\\SOURCE\\dreamers_demo_${Date.now()}.mp4`;
      await createJob({
        type: "ffmpeg",
        input: JSON.stringify({
          sourcePath: DEMO_SOURCE,
          outputPath,
          codec: "h264_nvenc",
          qualityMode: "cq",
          quality: 20,
          preset: "p4",
          audioCodec: "aac",
        }),
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  // Phase 4 (P4-4) demo: a real Topaz Video AI upscale ("tvai_up") job
  // against the same real source clip as the FFmpeg demo above, so the
  // job engine shows a real GPU upscale running, not just a synthetic
  // job. Requires Topaz Video AI installed + configured
  // (topaz_config.json) on at least one worker — see
  // docs/PROJECT_STATUS.md's Phase 4 section.
  async function handleCreateTopazDemoJob() {
    setCreating(true);
    setActionError(null);
    try {
      const outputPath = `\\\\192.29.11.92\\web_data\\www\\Projects\\SOURCE\\dreamers_topaz_demo_${Date.now()}.mp4`;
      await createJob({
        type: "topaz",
        input: JSON.stringify({
          sourcePath: DEMO_SOURCE,
          outputPath,
          model: "iris-2",
          scale: 2,
          codec: "h264_nvenc",
          qualityMode: "cq",
          quality: 20,
          preset: "p4",
          audioCodec: "aac",
        }),
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleAction(job: Job) {
    setActionError(null);
    setBusy(job.id);
    try {
      if (job.status === "FAILED") await retryJob(job.id);
      else await cancelJob(job.id);
      setJobs(await listJobs());
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(null); }
  }

  const all = jobs ?? [];
  const count = (value: Tab) => value === "All" ? all.length : all.filter(j => LABEL[j.status] === value).length;
  const filtered = all.filter(job => (tab === "All" || LABEL[job.status] === tab) &&
    `${sourceName(job)} ${job.id} ${job.type} ${workerNames.get(job.worker_id ?? -1) ?? job.worker_id ?? ""}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === "priority" ? b.priority - a.priority || b.id - a.id : sort === "progress" ? b.progress - a.progress || b.id - a.id : b.id - a.id);
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * 10, currentPage * 10);
  const online = machines?.filter(m => m.agentOnline).length ?? 0;
  const canCancel = new Set<JobStatus>(["QUEUED", "ASSIGNED", "RUNNING"]);

  return (
    <div className="queue-app">
      <header className="queue-topbar">
        <Link to="/" className="queue-brand"><span className="queue-mark" aria-hidden="true">◈</span> DREAMERS <span>STUDIO OS</span></Link>
        <div className="queue-breadcrumb">Workspace <span>/</span> <strong>Encode & Render Queue</strong></div>
        <div className="queue-user"><span className="queue-avatar">{username.slice(0, 2).toUpperCase()}</span><span>{username}<small>Studio workspace</small></span></div>
      </header>
      <aside className="queue-sidebar">
        <div className="queue-nav-label">WORKSPACE</div>
        <Link to="/" className="queue-nav"><span aria-hidden="true">▦</span> Overview</Link>
        <div className="queue-nav-label">RENDER & ENCODE</div>
        <Link to="/jobs" className="queue-nav active" aria-current="page"><span aria-hidden="true">▤</span> Render queue <span className="queue-nav-count">{jobs === null ? "—" : all.length}</span></Link>
        <Link to="/" className="queue-nav"><span aria-hidden="true">▣</span> Machines</Link>
        <div className="queue-sidebar-bottom">
          <div className="queue-system"><strong><span className={`queue-dot ${error || machineError ? "warning" : ""}`} /> System status</strong><p>{error || machineError ? "Connection needs attention" : jobs === null || machines === null ? "Connecting to studio…" : "Connected to studio"}</p><dl><div><dt>Online machines</dt><dd>{machines === null || machineError ? "—" : `${online} / ${machines.length}`}</dd></div><div><dt>Running jobs</dt><dd>{jobs === null ? "—" : count("Running")}</dd></div><div><dt>Pending jobs</dt><dd>{jobs === null ? "—" : count("Pending")}</dd></div><div><dt>Failed jobs</dt><dd className="queue-red">{jobs === null ? "—" : count("Failed")}</dd></div></dl></div>
          <p className="queue-version">Dreamers Studio OS <span>Render workspace</span></p>
        </div>
      </aside>
      <main className="queue-main">
        <div className="queue-heading"><div><div className="queue-eyebrow">RENDER & ENCODE</div><h1>Encode & Render Queue</h1><p>Monitor and manage jobs across your studio machines.</p></div><button className="queue-button primary" onClick={() => setShowCreate(v => !v)} aria-expanded={showCreate} aria-controls="queue-create">{showCreate ? "Close" : "+ New job"}</button></div>
        {showCreate && <section className="queue-create" id="queue-create" aria-label="Create a job"><div><strong>Create a demo job</strong><p>Encode and upscale demos use the configured studio source clip and create a new output file.</p></div><div className="queue-create-actions"><button className="queue-button" onClick={handleCreateTestJob} disabled={creating}>Test · 10 seconds</button><button className="queue-button" onClick={handleCreateFfmpegDemoJob} disabled={creating}>FFmpeg · GPU encode</button><button className="queue-button" onClick={handleCreateTopazDemoJob} disabled={creating}>Topaz · 2× upscale</button></div>{creating && <small role="status">Creating job…</small>}</section>}
        {(error || actionError) && <div className="queue-alert" role="alert">{actionError || `Unable to refresh jobs. ${error}`}</div>}
        <section className="queue-stats" aria-label="Queue summary">{([ ["All", "Total jobs", "▤"], ["Running", "Running", "↗"], ["Completed", "Completed", "✓"], ["Pending", "Pending", "◷"], ["Failed", "Failed", "×"] ] as const).map(([value, label, icon]) => <button key={value} className={`queue-stat ${value.toLowerCase()}`} onClick={() => { setTab(value); setPage(1); }} aria-pressed={tab === value}><span className="queue-stat-icon" aria-hidden="true">{icon}</span><span className="queue-stat-body"><span>{label}</span><strong>{jobs === null ? "—" : count(value)}</strong><span className="queue-stat-note">{value === "All" ? "Across all machines" : `${all.length ? Math.round(count(value) / all.length * 100) : 0}% of total jobs`}</span><span className="queue-track"><span style={{ width: `${all.length ? count(value) / all.length * 100 : 0}%` }} /></span></span></button>)}</section>
        <section className="queue-work" aria-label="Jobs">
          <div className="queue-search"><span aria-hidden="true">⌕</span><input aria-label="Search jobs and machines" placeholder="Search jobs, source files, machines…" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} />{query && <button aria-label="Clear search" onClick={() => { setQuery(""); setPage(1); }}>×</button>}<span className="queue-live"><span className={`queue-dot ${error ? "warning" : ""}`} />{error ? "Refresh failed" : "Auto refresh · 3s"}</span></div>
          <div className="queue-table-toolbar"><div className="queue-tabs" aria-label="Filter by status">{TABS.map(value => <button key={value} aria-pressed={tab === value} className={tab === value ? "selected" : ""} onClick={() => { setTab(value); setPage(1); }}>{value}<span>{jobs === null ? "—" : count(value)}</span></button>)}</div><label className="queue-sort">Sort by <select aria-label="Sort jobs" value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}><option value="priority">Priority</option><option value="newest">Newest</option><option value="progress">Progress</option></select></label></div>
          <div className="queue-table-scroll"><table className="queue-table"><thead><tr><th scope="col">JOB / SOURCE</th><th scope="col">MACHINE</th><th scope="col">PROGRESS</th><th scope="col">STATUS</th><th scope="col">TIME</th><th scope="col" className="queue-action-heading">ACTIONS</th></tr></thead><tbody>{visible.map(job => {
            const progress = Math.max(0, Math.min(100, job.progress || 0));
            const elapsed = job.started_at ? (new Date(job.finished_at ?? Date.now()).getTime() - new Date(job.started_at).getTime()) / 1000 : null;
            return <tr key={job.id}><td><div className="queue-job-cell"><span className={`queue-app-icon ${job.type === "topaz" ? "topaz" : job.type === "ffmpeg" ? "encode" : "test"}`}>{job.type === "topaz" ? "Tv" : job.type === "ffmpeg" ? "En" : "Ts"}</span><div className="queue-job-info"><strong title={sourceName(job)}>{sourceName(job)}</strong><small>#{job.id} · {job.type} · Priority {job.priority}</small>{job.depends_on !== null && <small>Depends on #{job.depends_on}</small>}{job.retry_count > 0 && <small>Attempt {job.retry_count + 1}</small>}{job.error && <details className="queue-job-error"><summary>Error details</summary><p>{job.error}</p></details>}</div></div></td><td>{job.worker_id !== null ? <Link className="queue-machine-link" to={`/workstations/${job.worker_id}`}>{workerNames.get(job.worker_id) ?? `Machine #${job.worker_id}`}</Link> : <span className="queue-muted">Unassigned</span>}<small>{job.gpu_slot !== null ? `GPU slot ${job.gpu_slot}` : "Auto allocation"}</small></td><td><div className="queue-progress-label"><span>{progress}%</span>{job.fps !== null && <small>{job.fps.toFixed(1)} fps</small>}</div><div className={`queue-progress ${job.status.toLowerCase()}`} role="progressbar" aria-label={`Job ${job.id} progress`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div></td><td><span className={`queue-badge ${LABEL[job.status].toLowerCase()}`}>{job.status === "ASSIGNED" ? "Assigned" : LABEL[job.status]}</span></td><td className="queue-time">{elapsed === null ? "Queued" : duration(elapsed)}<small>{job.eta_seconds !== null ? `ETA ${duration(job.eta_seconds)}` : job.finished_at ? "Finished" : job.status === "RUNNING" ? "Processing…" : "—"}</small></td><td className="queue-actions">{(canCancel.has(job.status) || job.status === "FAILED") ? <button className="queue-icon-button" aria-label={`${job.status === "FAILED" ? "Retry" : "Cancel"} job ${job.id}`} title={job.status === "FAILED" ? "Retry job" : "Cancel job"} disabled={busy !== null} onClick={() => handleAction(job)}>{busy === job.id ? "…" : job.status === "FAILED" ? "↻" : "■"}</button> : <span className="queue-muted">—</span>}</td></tr>;
          })}</tbody></table></div>
          {visible.length === 0 && <div className="queue-empty" role="status"><span aria-hidden="true">▤</span><h2>{jobs === null ? error ? "Queue unavailable" : "Loading your queue…" : all.length === 0 ? "Your queue is clear" : "No matching jobs"}</h2><p>{jobs === null ? error ? "Check the backend connection. We’ll keep trying to reconnect." : "Fetching the latest jobs from your studio." : all.length === 0 ? "Create a new job to start encoding or rendering." : "Try another search or status filter."}</p></div>}
          <footer className="queue-pagination"><span>{filtered.length ? `${(currentPage - 1) * 10 + 1}–${Math.min(currentPage * 10, filtered.length)} of ${filtered.length} jobs` : "0 jobs"}</span><div><button className="queue-icon-button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>‹</button><span>Page {currentPage} of {pages}</span><button className="queue-icon-button" aria-label="Next page" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>›</button></div></footer>
        </section>
        <section className="queue-machines"><div className="queue-section-heading"><div><h2>Machine performance</h2><p>Live resource usage across your render fleet.</p></div><Link className="queue-button" to="/">View all machines <span aria-hidden="true">→</span></Link></div>{machineError ? <p className="queue-alert" role="status">Machine metrics are unavailable. Reconnecting…</p> : machines === null ? <p className="queue-muted" role="status">Loading machines…</p> : machines.length === 0 ? <p className="queue-muted">No machines registered yet.</p> : <div className="queue-machine-grid">{machines.map(machine => {
          const running = all.filter(j => j.worker_id === machine.id && j.status === "RUNNING").length;
          const state = !machine.agentOnline ? "Offline" : running ? "Running" : "Idle";
          const metrics = machine.agentOnline ? machine.metrics : null;
          return <Link to={`/workstations/${machine.id}`} className="queue-machine-card" key={machine.id}><div className="queue-machine-title"><strong>{machine.name}</strong><span className={`queue-badge ${state.toLowerCase()}`}>{state}</span></div><p title={metrics?.gpus?.map(g => g.name).join(", ")}>{metrics?.gpus?.map(g => g.name).join(", ") || (machine.agentOnline ? "GPU metrics unavailable" : "Agent disconnected")}</p><div className="queue-machine-metrics">{([ ["CPU", metrics?.cpu?.utilizationPercent], ["GPU", metrics?.gpus?.[0]?.utilizationPercent], ["RAM", metrics?.memory?.usagePercent] ] as const).map(([label, value]) => <div key={label}><small>{label}</small><strong>{percent(value)}</strong><span className="queue-track"><span style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} /></span></div>)}</div><div className="queue-machine-footer"><span className={`queue-dot ${!machine.agentOnline ? "offline" : ""}`} />{jobs === null ? "Jobs unavailable" : `${running} active ${running === 1 ? "job" : "jobs"}`}<span>Open machine ↗</span></div></Link>;
        })}</div>}</section>
        <div className="queue-footer">DREAMERS STUDIO OS <span>Built for the work behind the frame.</span></div>
      </main>
    </div>
  );
}
