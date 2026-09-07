import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listAudit, listAuditActions } from "../api/audit";
import { getWorkstationsStatus } from "../api/workstations";
import { listJobs } from "../api/jobs";
import type { AuditAction, AuditEntry } from "../types/audit";
import type { Job } from "../types/job";
import type { WorkstationStatus } from "../types/workstation";
import StudioSidebar from "../components/StudioSidebar";
import LanguageToggle from "../components/LanguageToggle";
import StudioIcon from "../components/StudioIcon";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/translations";
import "./JobsPage.css";

const PAGE_SIZE = 50;
// Slower than the dashboard's 5s: an audit trail is read, not watched, and
// each poll is a COUNT plus a page scan. Manual refresh covers "did my
// action land" without making every open tab hammer the endpoint.
const POLL_MS = 15000;

// Unknown keys (a server-side action added before this map is updated) fall
// back to the raw string, so a new event type shows up as itself rather than
// vanishing from the list.
const ACTION_LABEL: Record<AuditAction, TranslationKey> = {
  "login.success": "auditLoginSuccess",
  "login.failure": "auditLoginFailure",
  logout: "auditLogout",
  "remote.start": "auditRemoteStart",
  "remote.end": "auditRemoteEnd",
  "workstation.create": "auditWorkstationCreate",
  "workstation.update": "auditWorkstationUpdate",
  "workstation.delete": "auditWorkstationDelete",
  "workstation.wake": "auditWorkstationWake",
  "workstation.command": "auditWorkstationCommand",
  "workstation.agent_token": "auditWorkstationAgentToken",
};

// Severity is presentational only — the server stores no such field. A failed
// login is the one event worth spotting in a wall of rows; destructive and
// session events get their own tint so scanning by colour is possible without
// relying on colour alone (the label always says what happened).
function toneFor(action: string): string {
  if (action === "login.failure") return "failed";
  if (action === "workstation.delete" || action === "workstation.command") return "pending";
  if (action === "remote.start" || action === "remote.end") return "running";
  return "";
}

function formatDetail(detail: string | null): string | null {
  if (!detail) return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    if (!parsed || typeof parsed !== "object") return detail;
    return Object.entries(parsed as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
      .join(" · ");
  } catch {
    return detail;
  }
}

export default function AuditPage({ username }: { username: string }) {
  const { t, lang } = useLanguage();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [actions, setActions] = useState<AuditAction[]>([]);
  const [action, setAction] = useState<AuditAction | "">("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Sidebar context (machine/job counters) — the sidebar is shared with the
  // dashboard and queue pages and expects these; failures there must not
  // take the log itself down, so they only flip the sidebar's own flags.
  const [machines, setMachines] = useState<WorkstationStatus[] | null>(null);
  const [machineError, setMachineError] = useState(false);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [jobsError, setJobsError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listAudit({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, action });
      setEntries(result.entries);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [action, page]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    listAuditActions()
      .then(setActions)
      .catch(() => setActions([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function pollContext() {
      try {
        const result = await getWorkstationsStatus();
        if (!cancelled) {
          setMachines(result);
          setMachineError(false);
        }
      } catch {
        if (!cancelled) setMachineError(true);
      }
      try {
        const result = await listJobs();
        if (!cancelled) {
          setJobs(result);
          setJobsError(false);
        }
      } catch {
        if (!cancelled) setJobsError(true);
      }
    }
    void pollContext();
    const timer = setInterval(pollContext, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  function actionLabel(value: string): string {
    const key = ACTION_LABEL[value as AuditAction];
    return key ? t(key) : value;
  }

  function formatAt(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString(lang === "vi" ? "vi-VN" : "en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const shownFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const shownTo = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="queue-app">
      <StudioSidebar
        ready={machines !== null}
        error={machineError}
        total={machines?.length ?? 0}
        online={machines?.filter((machine) => machine.agentOnline).length ?? 0}
        jobs={jobs}
        jobsError={jobsError}
      />
      <div className="queue-workspace">
        <header className="queue-topbar">
          <div className="queue-breadcrumb">
            {t("queueBreadcrumbWorkspace")} <span>/</span> <strong>{t("auditTitle")}</strong>
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
              <p className="queue-eyebrow">{t("auditEyebrow")}</p>
              <h1>{t("auditTitle")}</h1>
              <p>{t("auditSubtitle")}</p>
            </div>
            <button className="queue-button" onClick={() => void load()} disabled={loading}>
              <StudioIcon name="refresh" />
              {loading ? t("auditRefreshing") : t("auditRefresh")}
            </button>
          </div>

          {error && <div className="queue-alert">{error}</div>}

          <div className="queue-table-toolbar">
            <div className="queue-tabs">
              <button
                className={action === "" ? "selected" : ""}
                onClick={() => {
                  setAction("");
                  setPage(0);
                }}
              >
                {t("auditFilterAll")}
                <span>{total}</span>
              </button>
            </div>
            <div className="queue-sort">
              <label htmlFor="audit-action">{t("auditFilterLabel")}</label>
              <select
                id="audit-action"
                value={action}
                onChange={(event) => {
                  setAction(event.target.value as AuditAction | "");
                  setPage(0);
                }}
              >
                <option value="">{t("auditFilterAll")}</option>
                {actions.map((value) => (
                  <option key={value} value={value}>
                    {actionLabel(value)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {entries && entries.length === 0 ? (
            <div className="queue-empty">
              <span>
                <StudioIcon name="queue" />
              </span>
              <h2>{t("auditEmptyTitle")}</h2>
              <p>{t("auditEmptyBody")}</p>
            </div>
          ) : (
            <div className="queue-table-scroll">
              <table className="queue-table">
                <thead>
                  <tr>
                    <th>{t("auditColTime")}</th>
                    <th>{t("auditColAction")}</th>
                    <th>{t("auditColActor")}</th>
                    <th>{t("auditColTarget")}</th>
                    <th>{t("auditColDetail")}</th>
                    <th>{t("auditColIp")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(entries ?? []).map((entry) => (
                    <tr key={entry.id}>
                      <td className="queue-time">{formatAt(entry.at)}</td>
                      <td>
                        <span className={`queue-badge ${toneFor(entry.action)}`}>{actionLabel(entry.action)}</span>
                      </td>
                      <td>{entry.actor_username ?? <span className="queue-muted">{t("auditSystemActor")}</span>}</td>
                      <td>
                        {entry.target_type === "workstation" && entry.target_id ? (
                          <Link className="queue-machine-link" to={`/workstations/${entry.target_id}`}>
                            {entry.target_label ?? `#${entry.target_id}`}
                          </Link>
                        ) : (
                          entry.target_label ?? <span className="queue-muted">—</span>
                        )}
                      </td>
                      <td className="queue-muted">{formatDetail(entry.detail) ?? "—"}</td>
                      <td className="queue-muted">{entry.ip ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="queue-pagination">
            <span>{t("auditShowing", { from: shownFrom, to: shownTo, total })}</span>
            <div>
              <button className="queue-button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                {t("auditPrev")}
              </button>
              <button
                className="queue-button"
                disabled={page >= lastPage}
                onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
              >
                {t("auditNext")}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
