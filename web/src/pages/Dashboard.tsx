import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import WorkstationCard from "../components/WorkstationCard";
import StudioIcon, { type StudioIconName } from "../components/StudioIcon";
import AddWorkstationDialog from "../components/AddWorkstationDialog";
import { getWorkstationsStatus, listWorkstations } from "../api/workstations";
import { listJobs } from "../api/jobs";
import { API_BASE_URL } from "../api/config";
import { logout, type CurrentUser } from "../api/auth";
import type { Workstation, WorkstationStatus } from "../types/workstation";
import type { Job } from "../types/job";
import "./Dashboard.css";

const POLL_MS = 5000;
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
function average(values: (number | null | undefined)[]): string {
  const samples = values.filter((value): value is number => value != null && Number.isFinite(value));
  return samples.length ? `${Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length)}%` : "—";
}
function timestamp(value: string): number {
  return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
}
function eventTime(job: Job): number { return timestamp(job.finished_at ?? job.started_at ?? job.created_at); }
function ago(time: number): string {
  if (!Number.isFinite(time)) return "—";
  const minutes = Math.floor(Math.max(0, Date.now() - time) / 60000);
  return minutes === 0 ? "Just now" : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
}
function jobLabel(job: Job): string {
  try { const input = JSON.parse(job.input ?? "{}"); return String(input.sourcePath ?? `${job.type} job`).split(/[\\/]/).pop() || job.type; }
  catch { return `${job.type} job`; }
}
const jobState: Record<Job["status"], string> = { QUEUED: "queued", ASSIGNED: "assigned", RUNNING: "started", PAUSED: "paused", COMPLETED: "completed", FAILED: "failed", CANCELLED: "cancelled" };

export default function Dashboard({ user, onLogout }: { user: CurrentUser; onLogout: () => void }) {
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
  const [activeSection, setActiveSection] = useState("dashboard");
  const active = useRef(false);
  const inFlight = useRef(false);

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
        setStatusById(new Map(statuses.value.map(status => [status.id, status])));
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
    return () => { active.current = false; clearInterval(timer); };
  }, [refresh]);

  async function handleLogout() {
    setLoggingOut(true);
    setActionError(null);
    try { await logout(); onLogout(); }
    catch (err) { setActionError(errorText(err)); }
    finally { setLoggingOut(false); }
  }

  const machines = workstations ?? [];
  const enabled = machines.filter(machine => machine.enabled);
  const statusesReady = workstations !== null && refreshedAt !== null && !errors.status && !errors.machines;
  const online = enabled.filter(machine => statusById.get(machine.id)?.vncOnline).length;
  const healthy = enabled.filter(machine => { const status = statusById.get(machine.id); return status?.vncOnline && status.agentOnline; }).length;
  const liveMetrics = enabled.flatMap(machine => { const status = statusById.get(machine.id); return statusesReady && status?.agentOnline && status.metrics ? [status.metrics] : []; });
  const summaries: { title: string; value: string; note: string; icon: StudioIconName; tone: string }[] = [
    { title: "Workstations", value: statusesReady ? String(online) : "—", note: workstations === null ? "Loading machines" : `${enabled.length} enabled · ${machines.length} registered`, icon: "monitor", tone: "blue" },
    { title: "System health", value: statusesReady && enabled.length ? `${Math.round(healthy / enabled.length * 100)}%` : "—", note: "Agent + remote available", icon: "pulse", tone: "green" },
    { title: "Avg CPU usage", value: average(liveMetrics.map(metrics => metrics.cpu?.utilizationPercent)), note: "Across reporting agents", icon: "cpu", tone: "purple" },
    { title: "Avg RAM usage", value: average(liveMetrics.map(metrics => metrics.memory?.usagePercent)), note: "Across reporting agents", icon: "memory", tone: "amber" },
  ];
  const serviceHost = new URL(API_BASE_URL, window.location.origin).hostname;
  const recent = [...(jobs ?? [])].sort((a, b) => eventTime(b) - eventTime(a) || b.id - a.id).slice(0, 4);
  const navItems: { id: string; name: string; icon: StudioIconName }[] = [
    { id: "dashboard", name: "Dashboard", icon: "dashboard" },
    { id: "workstations", name: "Workstations", icon: "monitor" },
    { id: "monitoring", name: "Monitoring", icon: "pulse" },
    { id: "activity", name: "Job activity", icon: "clock" },
  ];

  return (
    <div className="studio-dashboard" id="dashboard">
      <a href="#studio-content" className="studio-skip">Skip to dashboard</a>
      <aside className="studio-sidebar" aria-label="Main navigation">
        <Link to="/" className="studio-brand"><svg width="36" height="38" viewBox="0 0 36 38" fill="none" aria-hidden="true"><path d="m18 2 14 8v18l-14 8-14-8V10L18 2Z" fill="#2678ed"/><path d="m18 11 6 3.5v9L18 27l-8-4.5v-7L18 11Z" fill="#0d1520"/><path d="m4 10 9 5v8l-9 5V10Z" fill="#609eff"/></svg><span>DREAMERS<small>REMOTE</small></span></Link>
        <nav>{navItems.map(item => <a key={item.id} href={`#${item.id}`} className={`studio-nav ${activeSection === item.id ? "active" : ""}`} aria-current={activeSection === item.id ? "location" : undefined} onClick={() => setActiveSection(item.id)}><StudioIcon name={item.icon} />{item.name}</a>)}<Link to="/jobs" className="studio-nav"><StudioIcon name="queue" />Render queue<StudioIcon name="arrow" /></Link></nav>
        <div className="studio-sidebar-bottom"><div className="studio-system"><strong><span className={`studio-dot ${statusesReady && healthy === enabled.length && enabled.length ? "online" : "unknown"}`} />System status</strong><p>{!statusesReady ? errors.status || errors.machines ? "Connection interrupted" : "Connecting to studio…" : !enabled.length ? "No enabled machines" : healthy === enabled.length ? "All systems operational" : `${enabled.length - healthy} machines need attention`}</p></div><div className="studio-version">Dreamers Remote<span>Studio infrastructure</span></div></div>
      </aside>
      <div className="studio-workspace">
        <header className="studio-topbar"><span className="studio-topbar-label">STUDIO WORKSPACE</span><div className="studio-topbar-right"><span className="studio-live"><span className={`studio-dot ${statusesReady ? "online" : "unknown"}`} />{statusesReady ? "Live · 5s updates" : "Connecting"}</span><div className="studio-user"><span className="studio-avatar">{user.username.slice(0, 2).toUpperCase()}</span><span>{user.username}</span></div><button className="studio-icon-button" aria-label="Log out" title="Log out" disabled={loggingOut} onClick={handleLogout}><StudioIcon name="logout" /></button></div></header>
        <main className="studio-content" id="studio-content">
          <div className="studio-heading"><div><h1>REMOTE DASHBOARD</h1><p>Manage and monitor all remote workstations.</p></div><div className="studio-heading-actions"><button className="studio-button" onClick={() => void refresh()} disabled={refreshing}><StudioIcon name="refresh" className={refreshing ? "spinning" : ""} />{refreshing ? "Refreshing…" : "Refresh"}</button><button className="studio-button primary" onClick={() => setShowAdd(true)}><StudioIcon name="plus" />Add Workstation</button></div></div>
          {(errors.machines || errors.status || actionError) && <div className="studio-alert" role="alert">{actionError ?? `Unable to refresh workstation data: ${errors.machines ?? errors.status}`}</div>}
          {notice && <div className="studio-notice" role="status"><StudioIcon name="check" />{notice}<button className="studio-icon-button" aria-label="Dismiss message" onClick={() => setNotice(null)}><StudioIcon name="close" /></button></div>}
          <section className="studio-summary" id="monitoring" aria-label="Workstation summary">{summaries.map(summary => <div className={`studio-stat ${summary.tone}`} key={summary.title}><span className="studio-stat-icon"><StudioIcon name={summary.icon} /></span><div><strong>{summary.value}</strong><span>{summary.title}</span><small>{summary.note}</small></div></div>)}</section>
          <section id="workstations" className="studio-workstations" aria-label="Workstations">
            {machines.map(machine => <WorkstationCard key={machine.id} workstation={machine} status={statusById.get(machine.id)} stale={!!errors.status || !!errors.machines} />)}
            {machines.length === 0 && <div className="studio-empty"><StudioIcon name="monitor" /><h2>{workstations === null ? errors.machines ? "Workstations unavailable" : "Loading your workspace…" : "Your workspace starts here"}</h2><p>{workstations === null ? "Checking the studio connection." : "Add your first workstation to monitor resources and connect remotely."}</p>{workstations !== null && <button className="studio-button primary" onClick={() => setShowAdd(true)}><StudioIcon name="plus" />Add Workstation</button>}</div>}
          </section>
          <div className="studio-bottom-grid">
            <section className="studio-panel studio-network" aria-labelledby="network-title"><header><h2 id="network-title"><StudioIcon name="network" />Network overview</h2><span className="studio-panel-tag">STUDIO LAN</span></header><div className="studio-network-caption"><span>Control server <strong>{serviceHost}</strong></span><span>{statusesReady ? `${online} / ${enabled.length} remote online` : "Status unavailable"}</span></div><div className="studio-network-root"><span><StudioIcon name="network" /></span><small>Dreamers server</small></div><div className="studio-network-nodes">{machines.map(machine => <Link key={machine.id} to={`/workstations/${machine.id}`} title={`${machine.name} · ${machine.ip}`}><span className={`studio-dot ${!statusesReady ? "unknown" : machine.enabled && statusById.get(machine.id)?.vncOnline ? "online" : "offline"}`} /><span>{machine.name}</span></Link>)}</div>{machines.length === 0 && <p className="studio-panel-empty">Registered machines will appear here.</p>}<p className="studio-network-note">Logical overview · remote availability</p></section>
            <section className="studio-panel studio-activity" id="activity" aria-labelledby="activity-title"><header><h2 id="activity-title"><StudioIcon name="clock" />Recent activity</h2><span className="studio-panel-tag">JOB UPDATES</span></header>{errors.jobs ? <p className="studio-panel-empty" role="status">Job history is unavailable. Retrying automatically.</p> : jobs === null ? <p className="studio-panel-empty">Loading recent jobs…</p> : recent.length === 0 ? <p className="studio-panel-empty">No jobs yet. Your latest job updates will appear here.</p> : <ul className="studio-activity-list">{recent.map(job => <li key={job.id}><span className={`studio-event-icon ${job.status.toLowerCase()}`}><StudioIcon name={job.status === "COMPLETED" ? "check" : job.status === "FAILED" ? "close" : "queue"} /></span><div><div><strong>{machines.find(machine => machine.id === job.worker_id)?.name ?? (job.worker_id ? `Machine #${job.worker_id}` : "Queue")}</strong><span>{job.type} job {jobState[job.status]}</span></div><small title={jobLabel(job)}>#{job.id} · {jobLabel(job)}</small></div><time title={new Date(eventTime(job)).toString()}>{ago(eventTime(job))}</time></li>)}</ul>}<Link to="/jobs" className="studio-activity-link">View render queue<StudioIcon name="arrow" /></Link></section>
          </div>
          <footer className="studio-page-footer"><span>DREAMERS REMOTE<span className="studio-footer-divider">/</span>STUDIO CONTROL</span><span>{refreshedAt ? `Last sync ${new Date(refreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Waiting for studio data"}</span></footer>
        </main>
      </div>
      {showAdd && <AddWorkstationDialog onClose={() => setShowAdd(false)} onCreated={machine => { setWorkstations(current => [...(current ?? []).filter(item => item.id !== machine.id), machine].sort((a, b) => a.name.localeCompare(b.name))); setNotice(`${machine.name} added to the workspace.`); void refresh(); }} />}
    </div>
  );
}
