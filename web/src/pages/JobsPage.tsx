import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { cancelJob, createJob, deleteJob, listJobs, retryJob } from "../api/jobs";
import { getWorkstationsStatus, listWorkstations } from "../api/workstations";
import type { Job, JobStatus } from "../types/job";
import type { WorkstationStatus } from "../types/workstation";
import StudioSidebar from "../components/StudioSidebar";
import LanguageToggle from "../components/LanguageToggle";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/translations";
import "./JobsPage.css";

const POLL_MS = 3000;
const TABS = ["All", "Running", "Pending", "Completed", "Failed", "Paused", "Cancelled"] as const;
type Tab = (typeof TABS)[number];
const LABEL: Record<JobStatus, Tab> = {
  QUEUED: "Pending",
  ASSIGNED: "Pending",
  RUNNING: "Running",
  COMPLETED: "Completed",
  FAILED: "Failed",
  PAUSED: "Paused",
  CANCELLED: "Cancelled",
};
// Internal Tab/state values above stay English (used as discriminators
// in filtering/CSS-class logic) -- these map them to a display string.
const tabLabelKey: Record<Tab, TranslationKey> = {
  All: "tabAll",
  Running: "tabRunning",
  Pending: "tabPending",
  Completed: "tabCompleted",
  Failed: "tabFailed",
  Paused: "tabPaused",
  Cancelled: "tabCancelled",
};
const statLabelKey: Record<Tab, TranslationKey> = {
  All: "statTotalJobs",
  Running: "statRunning",
  Pending: "statPending",
  Completed: "statCompleted",
  Failed: "statFailed",
  Paused: "tabPaused",
  Cancelled: "tabCancelled",
};

function sourceName(job: Job): string {
  try {
    const input = JSON.parse(job.input ?? "{}");
    return String(input.sourcePath ?? `${job.type} job #${job.id}`).split(/[\\/]/).pop() || `Job #${job.id}`;
  } catch {
    return `${job.type} job #${job.id}`;
  }
}

function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const value = Math.max(0, Math.round(seconds));
  return [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60].map((n) => String(n).padStart(2, "0")).join(":");
}

function percent(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value)}%`;
}

export default function JobsPage({ username }: { username: string }) {
  const { t } = useLanguage();
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
        if (!cancelled) {
          setMachines(result);
          setMachineError(false);
        }
      } catch {
        if (!cancelled) setMachineError(true);
      }
    }
    void pollMachines();
    const timer = setInterval(pollMachines, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
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
    } finally {
      setBusy(null);
    }
  }

  // Only reachable for a terminal job (COMPLETED/FAILED/CANCELLED/PAUSED
  // -- see the actions cell below); the server still enforces this
  // independently (409 on a still-active job) rather than trusting the
  // UI's own gating.
  async function handleDelete(job: Job) {
    if (!window.confirm(t("confirmDeleteJob", { id: job.id }))) return;
    setActionError(null);
    setBusy(job.id);
    try {
      await deleteJob(job.id);
      setJobs(await listJobs());
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const all = jobs ?? [];
  const count = (value: Tab) => (value === "All" ? all.length : all.filter((j) => LABEL[j.status] === value).length);
  const filtered = all
    .filter(
      (job) =>
        (tab === "All" || LABEL[job.status] === tab) &&
        `${sourceName(job)} ${job.id} ${job.type} ${workerNames.get(job.worker_id ?? -1) ?? job.worker_id ?? ""}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => (sort === "priority" ? b.priority - a.priority || b.id - a.id : sort === "progress" ? b.progress - a.progress || b.id - a.id : b.id - a.id));
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * 10, currentPage * 10);
  const canCancel = new Set<JobStatus>(["QUEUED", "ASSIGNED", "RUNNING"]);

  const statIcons: Record<Tab, string> = { All: "▤", Running: "↗", Completed: "✓", Pending: "◷", Failed: "×", Paused: "◷", Cancelled: "×" };
  const statTabs: Tab[] = ["All", "Running", "Completed", "Pending", "Failed"];

  return (
    <div className="queue-app">
      <StudioSidebar ready={machines !== null} error={machineError} total={machines?.length ?? 0} online={machines?.filter(machine => machine.agentOnline).length ?? 0} jobs={jobs} jobsError={!!error} />
      <div className="queue-workspace">
      <header className="queue-topbar">

        <div className="queue-breadcrumb">
          {t("queueBreadcrumbWorkspace")} <span>/</span> <strong>{t("queueBreadcrumbCurrent")}</strong>
        </div>
        <div className="queue-topbar-actions">
        <LanguageToggle />
        <div className="queue-user">
          <span className="queue-avatar">{username.slice(0, 2).toUpperCase()}</span>
          <span>
            {username}
            <small>{t("queueStudioWorkspace")}</small>
          </span>
        </div>
        </div>
      </header>

      <main className="queue-main">
        <div className="queue-heading">
          <div>
            <h1>{t("queueTitle")}</h1>
            <p>{t("queueSubtitle")}</p>
          </div>
          <button className="queue-button primary" onClick={() => setShowCreate((v) => !v)} aria-expanded={showCreate} aria-controls="queue-create">
            {showCreate ? t("close") : t("newJob")}
          </button>
        </div>
        {showCreate && (
          <section className="queue-create" id="queue-create" aria-label="Create a job">
            <div>
              <strong>{t("createDemoJobTitle")}</strong>
              <p>{t("createDemoJobBody")}</p>
            </div>
            <div className="queue-create-actions">
              <button className="queue-button" onClick={handleCreateTestJob} disabled={creating}>
                {t("testJobButton")}
              </button>
              <button className="queue-button" onClick={handleCreateFfmpegDemoJob} disabled={creating}>
                {t("ffmpegDemoButton")}
              </button>
              <button className="queue-button" onClick={handleCreateTopazDemoJob} disabled={creating}>
                {t("topazDemoButton")}
              </button>
            </div>
            {creating && <small role="status">{t("creatingJob")}</small>}
          </section>
        )}
        {(error || actionError) && (
          <div className="queue-alert" role="alert">
            {actionError || t("unableToRefreshJobs", { reason: error ?? "" })}
          </div>
        )}
        <section className="queue-stats" aria-label="Queue summary">
          {statTabs.map((value) => (
            <button key={value} className={`queue-stat ${value.toLowerCase()}`} onClick={() => { setTab(value); setPage(1); }} aria-pressed={tab === value}>
              <span className="queue-stat-icon" aria-hidden="true">
                {statIcons[value]}
              </span>
              <span className="queue-stat-body">
                <span>{t(statLabelKey[value])}</span>
                <strong>{jobs === null ? "—" : count(value)}</strong>
                <span className="queue-stat-note">{value === "All" ? t("acrossAllMachines") : t("percentOfTotalJobs", { percent: all.length ? Math.round((count(value) / all.length) * 100) : 0 })}</span>
                <span className="queue-track">
                  <span style={{ width: `${all.length ? (count(value) / all.length) * 100 : 0}%` }} />
                </span>
              </span>
            </button>
          ))}
        </section>
        <section className="queue-work" aria-label="Jobs">
          <div className="queue-search">
            <span aria-hidden="true">⌕</span>
            <input aria-label="Search jobs and machines" placeholder={t("searchJobsPlaceholder")} value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
            {query && (
              <button aria-label={t("clearSearch")} onClick={() => { setQuery(""); setPage(1); }}>
                ×
              </button>
            )}
            <span className="queue-live">
              <span className={`queue-dot ${error ? "warning" : ""}`} />
              {error ? t("refreshFailed") : t("autoRefresh3s")}
            </span>
          </div>
          <div className="queue-table-toolbar">
            <div className="queue-tabs" aria-label="Filter by status">
              {TABS.map((value) => (
                <button key={value} aria-pressed={tab === value} className={tab === value ? "selected" : ""} onClick={() => { setTab(value); setPage(1); }}>
                  {t(tabLabelKey[value])}
                  <span>{jobs === null ? "—" : count(value)}</span>
                </button>
              ))}
            </div>
            <label className="queue-sort">
              {t("sortBy")}{" "}
              <select aria-label="Sort jobs" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
                <option value="priority">{t("sortPriority")}</option>
                <option value="newest">{t("sortNewest")}</option>
                <option value="progress">{t("sortProgress")}</option>
              </select>
            </label>
          </div>
          <div className="queue-table-scroll">
            <table className="queue-table">
              <thead>
                <tr>
                  <th scope="col">{t("colJobSource")}</th>
                  <th scope="col">{t("colMachine")}</th>
                  <th scope="col">{t("colProgress")}</th>
                  <th scope="col">{t("colStatus")}</th>
                  <th scope="col">{t("colTime")}</th>
                  <th scope="col" className="queue-action-heading">
                    {t("colActions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((job) => {
                  const progress = Math.max(0, Math.min(100, job.progress || 0));
                  const elapsed = job.started_at ? (new Date(job.finished_at ?? Date.now()).getTime() - new Date(job.started_at).getTime()) / 1000 : null;
                  return (
                    <tr key={job.id}>
                      <td>
                        <div className="queue-job-cell">
                          <span className={`queue-app-icon ${job.type === "topaz" ? "topaz" : job.type === "ffmpeg" ? "encode" : "test"}`}>
                            {job.type === "topaz" ? "Tv" : job.type === "ffmpeg" ? "En" : "Ts"}
                          </span>
                          <div className="queue-job-info">
                            <strong title={sourceName(job)}>{sourceName(job)}</strong>
                            <small>{t("priorityLabel", { id: job.id, type: job.type, priority: job.priority })}</small>
                            {job.depends_on !== null && <small>{t("dependsOn", { id: job.depends_on })}</small>}
                            {job.retry_count > 0 && <small>{t("attemptN", { n: job.retry_count + 1 })}</small>}
                            {job.error && (
                              <details className="queue-job-error">
                                <summary>{t("errorDetails")}</summary>
                                <p>{job.error}</p>
                              </details>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        {job.worker_id !== null ? (
                          <Link className="queue-machine-link" to={`/workstations/${job.worker_id}`}>
                            {workerNames.get(job.worker_id) ?? t("machineHash", { id: job.worker_id })}
                          </Link>
                        ) : (
                          <span className="queue-muted">{t("unassigned")}</span>
                        )}
                        <small>{job.gpu_slot !== null ? t("gpuSlotN", { n: job.gpu_slot }) : t("autoAllocation")}</small>
                      </td>
                      <td>
                        <div className="queue-progress-label">
                          <span>{progress}%</span>
                          {job.fps !== null && <small>{t("fpsValue", { fps: job.fps.toFixed(1) })}</small>}
                        </div>
                        <div className={`queue-progress ${job.status.toLowerCase()}`} role="progressbar" aria-label={`Job ${job.id} progress`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                          <span style={{ width: `${progress}%` }} />
                        </div>
                      </td>
                      <td>
                        <span className={`queue-badge ${LABEL[job.status].toLowerCase()}`}>{job.status === "ASSIGNED" ? t("statusAssigned") : t(tabLabelKey[LABEL[job.status]])}</span>
                      </td>
                      <td className="queue-time">
                        {elapsed === null ? t("queuedLabel") : duration(elapsed)}
                        <small>{job.eta_seconds !== null ? t("etaLabel", { value: duration(job.eta_seconds) }) : job.finished_at ? t("finishedLabel") : job.status === "RUNNING" ? t("processingLabel") : "—"}</small>
                      </td>
                      <td className="queue-actions">
                        <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                          {(canCancel.has(job.status) || job.status === "FAILED") && (
                            <button
                              className="queue-icon-button"
                              aria-label={job.status === "FAILED" ? t("retryJobAria", { id: job.id }) : t("cancelJobAria", { id: job.id })}
                              title={job.status === "FAILED" ? t("retryJob") : t("cancelJob")}
                              disabled={busy !== null}
                              onClick={() => handleAction(job)}
                            >
                              {busy === job.id ? "…" : job.status === "FAILED" ? "↻" : "■"}
                            </button>
                          )}
                          {!canCancel.has(job.status) && (
                            <button
                              className="queue-icon-button"
                              aria-label={t("deleteJobAria", { id: job.id })}
                              title={t("deleteJob")}
                              disabled={busy !== null}
                              onClick={() => handleDelete(job)}
                            >
                              {busy === job.id ? "…" : "🗑"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {visible.length === 0 && (
            <div className="queue-empty" role="status">
              <span aria-hidden="true">▤</span>
              <h2>{jobs === null ? (error ? t("queueEmptyUnavailable") : t("queueEmptyLoading")) : all.length === 0 ? t("queueEmptyClear") : t("queueEmptyNoMatch")}</h2>
              <p>{jobs === null ? (error ? t("queueEmptyCheckBackend") : t("queueEmptyFetching")) : all.length === 0 ? t("queueEmptyCreateNew") : t("queueEmptyTrySearch")}</p>
            </div>
          )}
          <footer className="queue-pagination">
            <span>{filtered.length ? t("paginationRange", { from: (currentPage - 1) * 10 + 1, to: Math.min(currentPage * 10, filtered.length), total: filtered.length }) : t("paginationZero")}</span>
            <div>
              <button className="queue-icon-button" aria-label={t("previousPage")} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
                ‹
              </button>
              <span>{t("pageOf", { current: currentPage, total: pages })}</span>
              <button className="queue-icon-button" aria-label={t("nextPage")} disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>
                ›
              </button>
            </div>
          </footer>
        </section>
        <section className="queue-machines">
          <div className="queue-section-heading">
            <div>
              <h2>{t("machinePerformance")}</h2>
              <p>{t("machinePerformanceSubtitle")}</p>
            </div>
            <Link className="queue-button" to="/">
              {t("viewAllMachines")} <span aria-hidden="true">→</span>
            </Link>
          </div>
          {machineError ? (
            <p className="queue-alert" role="status">
              {t("machineMetricsUnavailable")}
            </p>
          ) : machines === null ? (
            <p className="queue-muted" role="status">
              {t("loadingMachines")}
            </p>
          ) : machines.length === 0 ? (
            <p className="queue-muted">{t("noMachinesRegistered")}</p>
          ) : (
            <div className="queue-machine-grid">
              {machines.map((machine) => {
                const running = all.filter((j) => j.worker_id === machine.id && j.status === "RUNNING").length;
                const state: "Offline" | "Running" | "Idle" = !machine.agentOnline ? "Offline" : running ? "Running" : "Idle";
                const stateKey: TranslationKey = state === "Offline" ? "machineOffline" : state === "Running" ? "machineRunning" : "machineIdle";
                const metrics = machine.agentOnline ? machine.metrics : null;
                const metricRows: [TranslationKey, number | null | undefined][] = [
                  ["cpuLabel", metrics?.cpu?.utilizationPercent],
                  ["gpuLabel", metrics?.gpus?.[0]?.utilizationPercent],
                  ["ramLabel", metrics?.memory?.usagePercent],
                ];
                return (
                  <Link to={`/workstations/${machine.id}`} className="queue-machine-card" key={machine.id}>
                    <div className="queue-machine-title">
                      <strong>{machine.name}</strong>
                      <span className={`queue-badge ${state.toLowerCase()}`}>{t(stateKey)}</span>
                    </div>
                    <p title={metrics?.gpus?.map((g) => g.name).join(", ")}>
                      {metrics?.gpus?.map((g) => g.name).join(", ") || (machine.agentOnline ? t("gpuMetricsUnavailable") : t("agentDisconnected"))}
                    </p>
                    <div className="queue-machine-metrics">
                      {metricRows.map(([labelKey, value]) => (
                        <div key={labelKey}>
                          <small>{t(labelKey)}</small>
                          <strong>{percent(value)}</strong>
                          <span className="queue-track">
                            <span style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="queue-machine-footer">
                      <span className={`queue-dot ${!machine.agentOnline ? "offline" : ""}`} />
                      {jobs === null ? t("jobsUnavailable") : t("activeJobsCount", { count: running, jobWord: t(running === 1 ? "jobSingular" : "jobPlural") })}
                      <span>{t("openMachine")} ↗</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
        <div className="queue-footer">
          {t("queueFooterTag")} <span>{t("queueFooterNote")}</span>
        </div>
      </main>
      </div>
    </div>
  );
}
