import { Fragment, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getWorkstation, getWorkstationMetrics, sendAgentCommand, type AgentCommand } from "../api/workstations";
import type { Workstation, WorkstationStatus } from "../types/workstation";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/translations";

const POLL_MS = 5000;

function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function WorkstationDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLanguage();
  const [workstation, setWorkstation] = useState<Workstation | null>(null);
  const [status, setStatus] = useState<WorkstationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCommand, setConfirmCommand] = useState<AgentCommand | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandMessage, setCommandMessage] = useState<string | null>(null);

  function formatLastSeen(iso: string | null): string {
    if (!iso) return t("neverSeen");
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (seconds < 60) return t("secondsAgo", { n: seconds });
    if (seconds < 3600) return t("minutesAgo", { n: Math.floor(seconds / 60) });
    return t("hoursAgo", { n: Math.floor(seconds / 3600) });
  }

  useEffect(() => {
    if (!id) return;
    getWorkstation(Number(id))
      .then(setWorkstation)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function poll() {
      try {
        const result = await getWorkstationMetrics(Number(id));
        if (!cancelled) {
          setStatus(result);
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
  }, [id]);

  const metrics = status?.agentOnline ? status.metrics : null;

  async function confirmSendCommand() {
    if (!id || !confirmCommand) return;
    const command = confirmCommand;
    setConfirmCommand(null);
    setCommandBusy(true);
    setCommandMessage(null);
    try {
      await sendAgentCommand(Number(id), command);
      setCommandMessage(t("commandSent", { command: command.toUpperCase() }));
    } catch (err) {
      setCommandMessage(t("commandFailed", { reason: err instanceof Error ? err.message : String(err) }));
    } finally {
      setCommandBusy(false);
    }
  }

  const commandKey: Record<AgentCommand, TranslationKey> = { restart: "restart", shutdown: "shutdown" };

  return (
    <div className="app">
      <header className="header remote-header">
        <div>
          <Link className="back-link" to="/">
            &larr; {t("backToWorkstations")}
          </Link>
          <h1>{workstation ? workstation.name : "..."}</h1>
        </div>
        <div className="remote-toolbar">
          {status?.vncOnline && (
            <Link className="btn btn-primary" to={`/remote/${id}`}>
              {t("remoteButton")}
            </Link>
          )}
          <button
            className="btn"
            disabled={!status?.agentOnline || commandBusy}
            title={status?.agentOnline ? undefined : t("agentOfflineNoCommand")}
            onClick={() => setConfirmCommand("restart")}
          >
            {t("restart")}
          </button>
          <button
            className="btn"
            disabled={!status?.agentOnline || commandBusy}
            title={status?.agentOnline ? undefined : t("agentOfflineNoCommand")}
            onClick={() => setConfirmCommand("shutdown")}
          >
            {t("shutdown")}
          </button>
        </div>
      </header>

      {error && <div className="error">{error}</div>}
      {commandMessage && <div className="notice">{commandMessage}</div>}

      {workstation && (
        <div className="detail-body">
          <section className="detail-section">
            <h2>{t("overviewHeading")}</h2>
            <div className="detail-grid">
              <span className="detail-label">{t("hostname")}</span>
              <span>{metrics?.hostname ?? workstation.hostname}</span>
              <span className="detail-label">{t("ipAddress")}</span>
              <span>{workstation.ip}</span>
              <span className="detail-label">{t("osLabel")}</span>
              <span>{metrics?.os ?? workstation.os ?? "—"}</span>
              <span className="detail-label">{t("agentVersion")}</span>
              <span>{metrics?.agentVersion ?? "—"}</span>
              <span className="detail-label">{t("uptime")}</span>
              <span>{metrics?.uptimeSeconds !== undefined ? formatUptime(metrics.uptimeSeconds) : "—"}</span>
              <span className="detail-label">{t("lastSeen")}</span>
              <span>{formatLastSeen(status?.lastSeen ?? null)}</span>
              <span className="detail-label">{t("vncLabel")}</span>
              <span>{status?.vncOnline ? t("statusOnline") : t("statusOffline")}</span>
              <span className="detail-label">{t("agentLabel")}</span>
              <span>{status?.agentOnline ? t("statusOnline") : t("statusOffline")}</span>
            </div>
          </section>

          {metrics?.cpu && (
            <section className="detail-section">
              <h2>{t("cpuHeading")}</h2>
              <div className="detail-grid">
                <span className="detail-label">{t("model")}</span>
                <span>{metrics.cpu.name}</span>
                <span className="detail-label">{t("cores")}</span>
                <span>{t("coresValue", { physical: metrics.cpu.physicalCoreCount, logical: metrics.cpu.logicalProcessorCount })}</span>
                <span className="detail-label">{t("usage")}</span>
                <span>
                  {metrics.cpu.utilizationPercent === null ? "…" : `${Math.round(metrics.cpu.utilizationPercent)}%`}
                </span>
              </div>
            </section>
          )}

          {metrics?.memory && (
            <section className="detail-section">
              <h2>{t("ramHeading")}</h2>
              <div className="detail-grid">
                <span className="detail-label">{t("used")}</span>
                <span>{(metrics.memory.usedMb / 1024).toFixed(1)} GB</span>
                <span className="detail-label">{t("available")}</span>
                <span>{(metrics.memory.availableMb / 1024).toFixed(1)} GB</span>
                <span className="detail-label">{t("total")}</span>
                <span>{(metrics.memory.totalMb / 1024).toFixed(1)} GB</span>
              </div>
            </section>
          )}

          {metrics?.gpus && metrics.gpus.length > 0 && (
            <section className="detail-section">
              <h2>{t("gpuHeading")}</h2>
              {metrics.gpus.map((gpu) => (
                <div className="detail-grid detail-gpu" key={gpu.index}>
                  <span className="detail-label">{t("gpuIndexOnly", { index: gpu.index })}</span>
                  <span>{gpu.name}</span>
                  <span className="detail-label">{t("usage")}</span>
                  <span>{Math.round(gpu.utilizationPercent)}%</span>
                  <span className="detail-label">{t("vramLabel")}</span>
                  <span>
                    {(gpu.vramUsedMb / 1024).toFixed(1)} / {(gpu.vramTotalMb / 1024).toFixed(0)} GB
                  </span>
                  <span className="detail-label">{t("temp")}</span>
                  <span>{gpu.temperatureCelsius !== null ? `${gpu.temperatureCelsius}°C` : "—"}</span>
                </div>
              ))}
            </section>
          )}

          {metrics?.disks && metrics.disks.length > 0 && (
            <section className="detail-section">
              <h2>{t("storageHeading")}</h2>
              <div className="detail-grid">
                {metrics.disks.map((disk) => (
                  <Fragment key={disk.name}>
                    <span className="detail-label">{disk.name}</span>
                    <span>
                      {(disk.usedMb / 1024).toFixed(0)} / {(disk.totalMb / 1024).toFixed(0)} GB (
                      {disk.usagePercent.toFixed(0)}%)
                    </span>
                  </Fragment>
                ))}
              </div>
            </section>
          )}

          {metrics?.processes && metrics.processes.length > 0 && (
            <section className="detail-section">
              <h2>{t("applicationsHeading")}</h2>
              <div className="apps">
                {metrics.processes.map((p) => (
                  <div className="app-row" key={p.name}>
                    <span className={`dot ${p.running ? "dot-online" : "dot-offline"}`} />
                    {p.name}
                    {p.running && p.ramMb !== null && ` — ${p.ramMb}MB`}
                  </div>
                ))}
              </div>
            </section>
          )}

          {!metrics && <div className="empty">{t("noAgentDataYet")}</div>}
        </div>
      )}

      {confirmCommand && (
        <div className="password-overlay">
          <div className="password-form">
            <p>{t("confirmCommandPrompt", { command: t(commandKey[confirmCommand]), machine: workstation?.name ?? "" })}</p>
            <div className="remote-toolbar">
              <button className="btn" onClick={() => setConfirmCommand(null)}>
                {t("cancel")}
              </button>
              <button className="btn btn-primary" onClick={confirmSendCommand}>
                {t("confirmButtonPrefix")} {t(commandKey[confirmCommand])}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
