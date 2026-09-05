import { Fragment, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { cancelJob, createJob, deleteAllTerminalJobs, deleteJob, listJobs, retryJob } from "../api/jobs";
import { getWorkstationsStatus, listWorkstations } from "../api/workstations";
import { login } from "../api/auth";
import type { Job, JobOrigin, JobProvenance, JobStatus } from "../types/job";
import type { WorkstationStatus } from "../types/workstation";
import StudioSidebar from "../components/StudioSidebar";
import LanguageToggle from "../components/LanguageToggle";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/translations";
import "./JobsPage.css";

// Password re-confirmation before a destructive action -- either
// deleting one specific job, or clearing all history. Both funnel
// through the same overlay/handler; PendingConfirm just carries which
// one to actually perform once the password checks out.
type PendingConfirm = { type: "delete"; job: Job } | { type: "clear" };

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

// Target resolution ("WxH", see FfmpegArgs.Build's scale-to-fit) --
// several jobs against the same source file only differ by this, so
// it's shown next to the filename to tell otherwise-identical-looking
// rows apart. Null (not "native") when the job didn't set one, so the
// row can distinguish "native size" from "no info available" too.
function jobResolution(job: Job): string | null {
  try {
    const input = JSON.parse(job.input ?? "{}");
    return typeof input.resolution === "string" && input.resolution ? input.resolution : null;
  } catch {
    return null;
  }
}

// Provenance is stored as a JSON string so the engine never has to
// migrate a column when a website starts sending a new identifier --
// which means the UI has to be tolerant of a row whose JSON it can't
// read, rather than blanking the whole page over one bad record.
function parseProvenance(job: Job): JobProvenance | null {
  if (!job.provenance) return null;
  try {
    const parsed = JSON.parse(job.provenance) as JobProvenance;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

// How each origin presents itself. `tone` drives the badge colour and
// exists for one reason: a test or hand-made job must never be able to
// look like real website production work at a glance.
const ORIGIN_META: Record<JobOrigin, { labelKey: TranslationKey; tone: "production" | "test" | "manual" }> = {
  website_shot_version: { labelKey: "originWebsiteShotVersion", tone: "production" },
  website_project_upload: { labelKey: "originWebsiteProjectUpload", tone: "production" },
  upload_test: { labelKey: "originUploadTest", tone: "test" },
  admin_manual: { labelKey: "originAdminManual", tone: "manual" },
  internal_test: { labelKey: "originInternalTest", tone: "test" },
};

function originMeta(origin: JobOrigin | null) {
  // A job from before provenance existed, or from a caller that didn't
  // declare itself, is Legacy/Unknown -- deliberately not guessed at
  // from its type or input, since a wrong provenance claim in an audit
  // trail is worse than an honest "unknown".
  return origin ? ORIGIN_META[origin] : { labelKey: "originLegacy" as TranslationKey, tone: "legacy" as const };
}

function timestamp(iso: string | null): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

function secondsBetween(from: string | null, to: string | null): number | null {
  if (!from) return null;
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, (end - start) / 1000);
}

// Time spent waiting before execution actually began. engine_queued_at
// falls back to created_at for jobs predating that column -- for a
// first attempt the two are the same instant, so legacy rows still get
// a true queue time instead of a dash.
function queueSeconds(job: Job): number | null {
  return secondsBetween(job.engine_queued_at ?? job.created_at, job.started_at);
}

function encodeSeconds(job: Job): number | null {
  return secondsBetween(job.started_at, job.completed_at ?? job.failed_at ?? job.finished_at);
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
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearNotice, setClearNotice] = useState<string | null>(null);
  // One audit row open at a time -- these are wide, full-width rows, and
  // several open at once turns the queue into a wall of timestamps.
  const [auditOpen, setAuditOpen] = useState<number | null>(null);

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
      await createJob({ type: "test", input: JSON.stringify({ seconds: 10 }), origin: "internal_test" });
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
        // Hand-triggered from this dashboard, not website work -- the
        // badge must say so rather than let a demo encode sit in the
        // audit trail looking like a delivery.
        origin: "admin_manual",
        provenance: { uploaded_by_name: username },
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
        origin: "admin_manual",
        provenance: { uploaded_by_name: username },
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

  // Both single-job delete and "clear history" are permanent and need a
  // fresh password before proceeding -- see PendingConfirm's doc comment
  // and submitPasswordConfirm below, which is what actually performs the
  // action once the password checks out. This just opens the overlay;
  // it's reachable for a terminal job (COMPLETED/FAILED/CANCELLED/
  // PAUSED -- see the actions cell below) since the server still
  // enforces that independently (409 on a still-active job) rather than
  // trusting the UI's own gating.
  function handleDelete(job: Job) {
    setConfirmError(null);
    setConfirmPassword("");
    setPendingConfirm({ type: "delete", job });
  }

  function handleClearAll() {
    setConfirmError(null);
    setConfirmPassword("");
    setPendingConfirm({ type: "clear" });
  }

  // The actual destructive action, gated on re-verifying the current
  // user's own password via the same POST /api/auth/login the login
  // screen uses -- not a client-side-only check (that would just be
  // theater), a real server round trip. A correct password also
  // refreshes the session cookie as a side effect, which is harmless
  // (same user, same session semantics as a normal login).
  async function submitPasswordConfirm(event: FormEvent) {
    event.preventDefault();
    if (!pendingConfirm) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      await login(username, confirmPassword);
    } catch {
      setConfirmError(t("passwordConfirmWrong"));
      setConfirming(false);
      return;
    }

    setActionError(null);
    try {
      if (pendingConfirm.type === "delete") {
        setBusy(pendingConfirm.job.id);
        await deleteJob(pendingConfirm.job.id);
      } else {
        setClearing(true);
        const { deleted } = await deleteAllTerminalJobs();
        setActionError(null);
        // Reuses actionError's slot for a transient, non-error status
        // line -- there's no separate "notice" surface on this page.
        window.setTimeout(() => setClearNotice(null), 6000);
        setClearNotice(t("clearHistoryResult", { count: deleted }));
      }
      setJobs(await listJobs());
      setPendingConfirm(null);
      setConfirmPassword("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setClearing(false);
      setConfirming(false);
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
          <div style={{ display: "flex", gap: 8 }}>
            <button className="queue-button" onClick={handleClearAll} disabled={clearing} title={t("clearHistoryNote")}>
              {clearing ? t("clearingHistory") : t("clearHistory")}
            </button>
            <button className="queue-button primary" onClick={() => setShowCreate((v) => !v)} aria-expanded={showCreate} aria-controls="queue-create">
              {showCreate ? t("close") : t("newJob")}
            </button>
          </div>
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
        {clearNotice && !actionError && (
          <div className="queue-alert" role="status" style={{ background: "#173b2e", color: "#71dc9f" }}>
            {clearNotice}
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
                  const origin = originMeta(job.origin);
                  const provenance = parseProvenance(job);
                  // The whole audit record in one place, so "where did
                  // this come from and what happened to it" is one
                  // expander rather than a hunt across columns. Every
                  // value falls back to "—" instead of being hidden, so
                  // a missing field reads as missing, not as absent
                  // structure.
                  const auditRows: [TranslationKey, string][] = [
                    ["auditOrigin", t(origin.labelKey)],
                    ["auditProject", provenance?.project_name ?? provenance?.project_id ?? "—"],
                    ["auditWebsiteJob", provenance?.job_name ?? provenance?.job_id ?? "—"],
                    ["auditShot", provenance?.shot_code ?? provenance?.shot_id ?? "—"],
                    ["auditVersion", provenance?.version_no !== null && provenance?.version_no !== undefined ? `v${provenance.version_no}` : provenance?.version_id ?? "—"],
                    ["auditUploadedBy", provenance?.uploaded_by_name ?? provenance?.uploaded_by_user_id ?? "—"],
                    ["auditUploadedAt", timestamp(provenance?.uploaded_at ?? null)],
                    ["auditWorker", job.worker_id === null ? t("unassigned") : `${workerNames.get(job.worker_id) ?? t("machineHash", { id: job.worker_id })} · ${job.gpu_slot !== null ? t("gpuSlotN", { n: job.gpu_slot }) : t("autoAllocation")}`],
                    ["auditEngineQueued", timestamp(job.engine_queued_at ?? job.created_at)],
                    ["auditAssigned", timestamp(job.assigned_at)],
                    ["auditQueueTime", duration(queueSeconds(job))],
                    ["auditEncodeStart", timestamp(job.started_at)],
                    ["auditEncodeComplete", timestamp(job.completed_at ?? job.failed_at ?? job.finished_at)],
                    ["auditEncodeDuration", duration(encodeSeconds(job))],
                    ["auditFinalStatus", job.status === "ASSIGNED" ? t("statusAssigned") : t(tabLabelKey[LABEL[job.status]])],
                  ];
                  return (
                    <Fragment key={job.id}>
                    <tr>
                      <td>
                        <div className="queue-job-cell">
                          <span className={`queue-app-icon ${job.type === "topaz" ? "topaz" : job.type === "ffmpeg" ? "encode" : "test"}`}>
                            {job.type === "topaz" ? "Tv" : job.type === "ffmpeg" ? "En" : "Ts"}
                          </span>
                          <div className="queue-job-info">
                            <strong title={sourceName(job)}>{sourceName(job)}</strong>
                            <div className="queue-job-tags">
                              <span className={`queue-origin ${origin.tone}`} title={t("originTitle")}>
                                {t(origin.labelKey)}
                              </span>
                              {jobResolution(job) && <span className="queue-badge">{jobResolution(job)}</span>}
                            </div>
                            <small>{t("priorityLabel", { id: job.id, type: job.type, priority: job.priority })}</small>
                            {job.depends_on !== null && <small>{t("dependsOn", { id: job.depends_on })}</small>}
                            {job.retry_count > 0 && <small>{t("attemptN", { n: job.retry_count + 1 })}</small>}
                            {/* Toggles a full-width row below rather than
                                expanding in place: this column is a fixed
                                30% of the table, too narrow to show
                                timestamps without truncating them. */}
                            <button
                              type="button"
                              className="queue-audit-toggle"
                              aria-expanded={auditOpen === job.id}
                              aria-controls={`audit-${job.id}`}
                              onClick={() => setAuditOpen((open) => (open === job.id ? null : job.id))}
                            >
                              <span aria-hidden="true">{auditOpen === job.id ? "▾" : "▸"}</span> {t("auditDetails")}
                            </button>
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
                    {auditOpen === job.id && (
                      <tr className="queue-audit-row">
                        <td colSpan={6} id={`audit-${job.id}`}>
                          <dl className="queue-audit-grid">
                            {auditRows.map(([labelKey, value]) => (
                              <div key={labelKey}>
                                <dt>{t(labelKey)}</dt>
                                <dd title={value}>{value}</dd>
                              </div>
                            ))}
                          </dl>
                        </td>
                      </tr>
                    )}
                    </Fragment>
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
      {pendingConfirm && (
        <div className="password-overlay">
          <form className="password-form" onSubmit={submitPasswordConfirm}>
            <strong>{t(pendingConfirm.type === "delete" ? "passwordConfirmTitleDelete" : "passwordConfirmTitleClear")}</strong>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-dim)" }}>
              {pendingConfirm.type === "delete"
                ? t("passwordConfirmBodyDelete", { id: pendingConfirm.job.id })
                : t("passwordConfirmBodyClear")}
            </p>
            <label htmlFor="confirm-password">{t("passwordConfirmLabel")}</label>
            <input
              id="confirm-password"
              type="password"
              autoFocus
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            {confirmError && <p className="login-error">{confirmError}</p>}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn"
                disabled={confirming}
                onClick={() => {
                  setPendingConfirm(null);
                  setConfirmPassword("");
                  setConfirmError(null);
                }}
              >
                {t("cancel")}
              </button>
              <button className="btn btn-primary" type="submit" disabled={confirming || confirmPassword === ""}>
                {confirming ? "…" : t("passwordConfirmSubmit")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
