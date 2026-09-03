import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import StudioSidebar from "../components/StudioSidebar";
import WorkstationCard from "../components/WorkstationCard";
import StudioIcon, { type StudioIconName } from "../components/StudioIcon";
import AddWorkstationDialog from "../components/AddWorkstationDialog";
import LanguageToggle from "../components/LanguageToggle";
import { getWorkstationsStatus, listWorkstations } from "../api/workstations";
import { listJobs } from "../api/jobs";
import { API_BASE_URL } from "../api/config";
import { logout, type CurrentUser } from "../api/auth";
import type { Workstation, WorkstationStatus } from "../types/workstation";
import type { Job } from "../types/job";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/translations";
import "./Dashboard.css";

const POLL_MS = 5000;
const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

function average(values: (number | null | undefined)[]): string {
  const samples = values.filter((value): value is number => value != null && Number.isFinite(value));
  return samples.length ? `${Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length)}%` : "—";
}

function timestamp(value: string): number {
  return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
}

function eventTime(job: Job): number {
  return timestamp(job.finished_at ?? job.started_at ?? job.created_at);
}

function jobLabel(job: Job): string {
  try {
    const input = JSON.parse(job.input ?? "{}");
    return String(input.sourcePath ?? `${job.type} job`).split(/[\\/]/).pop() || job.type;
  } catch {
    return `${job.type} job`;
  }
}

const jobStateKey: Record<Job["status"], TranslationKey> = {
  QUEUED: "jobStateQueued",
  ASSIGNED: "jobStateAssigned",
  RUNNING: "jobStateRunning",
  PAUSED: "jobStatePaused",
  COMPLETED: "jobStateCompleted",
  FAILED: "jobStateFailed",
  CANCELLED: "jobStateCancelled",
};

export default function Dashboard({ user, onLogout }: { user: CurrentUser; onLogout: () => void }) {
  const { t } = useLanguage();
  const [workstations, setWorkstations] = useState<Workstation[] | null>(null);
  const [statusById, setStatusById] = useState<Map<number, WorkstationStatus>>(new Map());
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [errors, setErrors] = useState<{ machines?: string; status?: string; jobs?: string }>({});
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const active = useRef(false);
  const inFlight = useRef(false);

  function ago(time: number): string {
    if (!Number.isFinite(time)) return "—";
    const minutes = Math.floor(Math.max(0, Date.now() - time) / 60000);
    if (minutes === 0) return t("justNow");
    if (minutes < 60) return t("minutesAgo", { n: minutes });
    if (minutes < 1440) return t("hoursAgo", { n: Math.floor(minutes / 60) });
    return t("daysAgo", { n: Math.floor(minutes / 1440) });
  }

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const [registry, statuses, queue] = await Promise.allSettled([listWorkstations(), getWorkstationsStatus(), listJobs()]);
      if (!active.current) return;
      const failures: typeof errors = {};
      if (registry.status === "fulfilled") setWorkstations(registry.value);
      else failures.machines = errorText(registry.reason);
      if (statuses.status === "fulfilled") {
        setStatusById(new Map(statuses.value.map((status) => [status.id, status])));
        setRefreshedAt(Date.now());
      } else failures.status = errorText(statuses.reason);
      if (queue.status === "fulfilled") setJobs(queue.value);
      else failures.jobs = errorText(queue.reason);
      setErrors(failures);
    } finally {
      inFlight.current = false;
      if (active.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    active.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      active.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  async function handleLogout() {
    setLoggingOut(true);
    setActionError(null);
    try {
      await logout();
      onLogout();
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setLoggingOut(false);
    }
  }

  const machines = workstations ?? [];
  const enabled = machines.filter((machine) => machine.enabled);
  const statusesReady = workstations !== null && refreshedAt !== null && !errors.status && !errors.machines;
  const online = enabled.filter((machine) => statusById.get(machine.id)?.vncOnline).length;
  const healthy = enabled.filter((machine) => {
    const status = statusById.get(machine.id);
    return status?.vncOnline && status.agentOnline;
  }).length;
  const liveMetrics = enabled.flatMap((machine) => {
    const status = statusById.get(machine.id);
    return statusesReady && status?.agentOnline && status.metrics ? [status.metrics] : [];
  });
  const summaries: { title: string; value: string; note: string; icon: StudioIconName; tone: string }[] = [
    {
      title: t("statWorkstations"),
      value: statusesReady ? String(online) : "—",
      note: workstations === null ? t("statLoadingMachines") : t("statEnabledRegistered", { enabled: enabled.length, total: machines.length }),
      icon: "monitor",
      tone: "blue",
    },
    {
      title: t("statSystemHealth"),
      value: statusesReady && enabled.length ? `${Math.round((healthy / enabled.length) * 100)}%` : "—",
      note: t("statSystemHealthNote"),
      icon: "pulse",
      tone: "green",
    },
    {
      title: t("statAvgCpu"),
      value: average(liveMetrics.map((metrics) => metrics.cpu?.utilizationPercent)),
      note: t("statAcrossAgents"),
      icon: "cpu",
      tone: "purple",
    },
    {
      title: t("statAvgRam"),
      value: average(liveMetrics.map((metrics) => metrics.memory?.usagePercent)),
      note: t("statAcrossAgents"),
      icon: "memory",
      tone: "amber",
    },
  ];
  const serviceHost = new URL(API_BASE_URL, window.location.origin).hostname;
  const recent = [...(jobs ?? [])].sort((a, b) => eventTime(b) - eventTime(a) || b.id - a.id).slice(0, 4);


  return (
    <div className="studio-dashboard" id="dashboard">
      <a href="#studio-content" className="studio-skip">
        {t("skipToDashboard")}
      </a>
      <StudioSidebar ready={!!statusesReady} error={!!errors.status || !!errors.machines} total={machines.length} online={machines.filter(machine => statusById.get(machine.id)?.agentOnline).length} jobs={jobs} jobsError={!!errors.jobs} />
      <div className="studio-workspace">
        <header className="studio-topbar">
          <span className="studio-topbar-label">{t("topbarLabel")}</span>
          <div className="studio-topbar-right">
            <span className="studio-live">
              <span className={`studio-dot ${statusesReady ? "online" : "unknown"}`} />
              {statusesReady ? t("liveUpdates") : t("connecting")}
            </span>
            <LanguageToggle />
            <div className="studio-user">
              <span className="studio-avatar">{user.username.slice(0, 2).toUpperCase()}</span>
              <span>{user.username}</span>
            </div>
            <button className="studio-icon-button" aria-label={t("logOut")} title={t("logOut")} disabled={loggingOut} onClick={handleLogout}>
              <StudioIcon name="logout" />
            </button>
          </div>
        </header>
        <main className="studio-content" id="studio-content">
          <div className="studio-heading">
            <div>
              <h1>{t("dashboardTitle")}</h1>
              <p>{t("dashboardSubtitle")}</p>
            </div>
            <div className="studio-heading-actions">
              <button className="studio-button" onClick={() => void refresh()} disabled={refreshing}>
                <StudioIcon name="refresh" className={refreshing ? "spinning" : ""} />
                {refreshing ? t("refreshing") : t("refresh")}
              </button>
              <button className="studio-button primary" onClick={() => setShowAdd(true)}>
                <StudioIcon name="plus" />
                {t("addWorkstation")}
              </button>
            </div>
          </div>
          {(errors.machines || errors.status || actionError) && (
            <div className="studio-alert" role="alert">
              {actionError ?? t("unableToRefresh", { reason: errors.machines ?? errors.status ?? "" })}
            </div>
          )}
          {notice && (
            <div className="studio-notice" role="status">
              <StudioIcon name="check" />
              {notice}
              <button className="studio-icon-button" aria-label={t("close")} onClick={() => setNotice(null)}>
                <StudioIcon name="close" />
              </button>
            </div>
          )}
          <section className="studio-summary" id="monitoring" aria-label="Workstation summary">
            {summaries.map((summary) => (
              <div className={`studio-stat ${summary.tone}`} key={summary.title}>
                <span className="studio-stat-icon">
                  <StudioIcon name={summary.icon} />
                </span>
                <div>
                  <strong>{summary.value}</strong>
                  <span>{summary.title}</span>
                  <small>{summary.note}</small>
                </div>
              </div>
            ))}
          </section>
          <section id="workstations" className="studio-workstations" aria-label="Workstations">
            {machines.map((machine) => (
              <WorkstationCard key={machine.id} workstation={machine} status={statusById.get(machine.id)} stale={!!errors.status || !!errors.machines} />
            ))}
            {machines.length === 0 && (
              <div className="studio-empty">
                <StudioIcon name="monitor" />
                <h2>{workstations === null ? (errors.machines ? t("workspaceEmptyTitleUnavailable") : t("workspaceEmptyTitleLoading")) : t("workspaceEmptyTitleReady")}</h2>
                <p>{workstations === null ? t("workspaceEmptyBodyChecking") : t("workspaceEmptyBodyReady")}</p>
                {workstations !== null && (
                  <button className="studio-button primary" onClick={() => setShowAdd(true)}>
                    <StudioIcon name="plus" />
                    {t("addWorkstation")}
                  </button>
                )}
              </div>
            )}
          </section>
          <div className="studio-bottom-grid">
            <section className="studio-panel studio-network" aria-labelledby="network-title">
              <header>
                <h2 id="network-title">
                  <StudioIcon name="network" />
                  {t("networkOverview")}
                </h2>
                <span className="studio-panel-tag">{t("networkTag")}</span>
              </header>
              <div className="studio-network-caption">
                <span>{t("controlServer", { host: serviceHost })}</span>
                <span>{statusesReady ? t("remoteOnlineCount", { online, total: enabled.length }) : t("statusUnavailable")}</span>
              </div>
              <div className="studio-network-root">
                <span>
                  <StudioIcon name="network" />
                </span>
                <small>{t("dreamersServer")}</small>
              </div>
              <div className="studio-network-nodes">
                {machines.map((machine) => (
                  <Link key={machine.id} to={`/workstations/${machine.id}`} title={`${machine.name} · ${machine.ip}`}>
                    <span className={`studio-dot ${!statusesReady ? "unknown" : machine.enabled && statusById.get(machine.id)?.vncOnline ? "online" : "offline"}`} />
                    <span>{machine.name}</span>
                  </Link>
                ))}
              </div>
              {machines.length === 0 && <p className="studio-panel-empty">{t("networkEmpty")}</p>}
              <p className="studio-network-note">{t("networkNote")}</p>
            </section>
            <section className="studio-panel studio-activity" id="activity" aria-labelledby="activity-title">
              <header>
                <h2 id="activity-title">
                  <StudioIcon name="clock" />
                  {t("recentActivity")}
                </h2>
                <span className="studio-panel-tag">{t("jobUpdatesTag")}</span>
              </header>
              {errors.jobs ? (
                <p className="studio-panel-empty" role="status">
                  {t("jobHistoryUnavailable")}
                </p>
              ) : jobs === null ? (
                <p className="studio-panel-empty">{t("loadingRecentJobs")}</p>
              ) : recent.length === 0 ? (
                <p className="studio-panel-empty">{t("noJobsYet")}</p>
              ) : (
                <ul className="studio-activity-list">
                  {recent.map((job) => (
                    <li key={job.id}>
                      <span className={`studio-event-icon ${job.status.toLowerCase()}`}>
                        <StudioIcon name={job.status === "COMPLETED" ? "check" : job.status === "FAILED" ? "close" : "queue"} />
                      </span>
                      <div>
                        <div>
                          <strong>{machines.find((machine) => machine.id === job.worker_id)?.name ?? (job.worker_id ? t("machineHash", { id: job.worker_id }) : t("queueLabel"))}</strong>
                          <span>{t("jobStateLine", { type: job.type, state: t(jobStateKey[job.status]) })}</span>
                        </div>
                        <small title={jobLabel(job)}>
                          #{job.id} · {jobLabel(job)}
                        </small>
                      </div>
                      <time title={new Date(eventTime(job)).toString()}>{ago(eventTime(job))}</time>
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/jobs" className="studio-activity-link">
                {t("viewRenderQueue")}
                <StudioIcon name="arrow" />
              </Link>
            </section>
          </div>
          <footer className="studio-page-footer">
            <span>
              {t("footerBrand")}
              <span className="studio-footer-divider">/</span>
              {t("footerControl")}
            </span>
            <span>{refreshedAt ? t("lastSync", { time: new Date(refreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }) : t("waitingForData")}</span>
          </footer>
        </main>
      </div>
      {showAdd && (
        <AddWorkstationDialog
          onClose={() => setShowAdd(false)}
          onCreated={(machine) => {
            setWorkstations((current) => [...(current ?? []).filter((item) => item.id !== machine.id), machine].sort((a, b) => a.name.localeCompare(b.name)));
            setNotice(t("addWorkstationSuccess", { name: machine.name }));
            void refresh();
          }}
        />
      )}
    </div>
  );
}
