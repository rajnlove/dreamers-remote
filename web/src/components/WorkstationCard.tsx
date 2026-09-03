import { useState } from "react";
import { Link } from "react-router-dom";
import { wakeWorkstation } from "../api/workstations";
import type { Workstation, WorkstationStatus } from "../types/workstation";
import StudioIcon from "./StudioIcon";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/translations";
import { useRemotePreview } from "../remotePreview";

interface Props {
  username: string;
  workstation: Workstation;
  status: WorkstationStatus | undefined;
  stale?: boolean;
}

function MetricBar({ label, value }: { label: string; value: number | null | undefined }) {
  const available = value != null && Number.isFinite(value);
  return (
    <div className="studio-metric">
      <span>{label}</span>
      <div
        className="studio-meter"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={available ? Math.max(0, Math.min(100, value)) : undefined}
        aria-valuetext={available ? `${Math.round(value)}%` : "Unavailable"}
      >
        <span style={{ width: `${available ? Math.max(0, Math.min(100, value)) : 0}%` }} />
      </div>
      <strong>{available ? `${Math.round(value)}%` : "—"}</strong>
    </div>
  );
}

export default function WorkstationCard({ username, workstation, status, stale = false }: Props) {
  const { t } = useLanguage();
  const preview = useRemotePreview(username, workstation.id);
  const [waking, setWaking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const online = status?.vncOnline && workstation.enabled;
  const agentOnline = status?.agentOnline && !stale;
  const metrics = agentOnline ? status?.metrics : null;
  const statusLabel: TranslationKey = !workstation.enabled
    ? "statusDisabled"
    : stale
      ? "statusUnknown"
      : !status
        ? "statusChecking"
        : online
          ? "statusOnline"
          : "statusOffline";
  const gpus = metrics?.gpus ?? [];

  function uptime(seconds: number | undefined): string {
    if (seconds == null || !Number.isFinite(seconds)) return t("unavailable");
    const minutes = Math.floor(Math.max(0, seconds) / 60);
    return `${Math.floor(minutes / 1440)}d ${Math.floor(minutes / 60) % 24}h ${minutes % 60}m`;
  }

  async function handleWake() {
    setWaking(true);
    setMessage(null);
    try {
      await wakeWorkstation(workstation.id);
      setMessage(t("wakeSignalSent"));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setWaking(false);
    }
  }

  return (
    <article className="studio-workstation" aria-label={workstation.name}>
      <header className="studio-card-header">
        <span
          className={`studio-dot ${statusLabel === "statusOnline" ? "online" : statusLabel === "statusOffline" || statusLabel === "statusDisabled" ? "offline" : "unknown"}`}
          title={t("remoteStatusPrefix", { status: t(statusLabel) })}
        />
        <Link to={`/workstations/${workstation.id}`} className="studio-card-name">
          {workstation.name}
        </Link>
        <span
          className={`studio-agent ${agentOnline ? "online" : ""}`}
          title={stale ? t("agentStatusUnavailable") : status?.agentOnline ? t("agentOnlineTitle") : t("agentOfflineTitle")}
        >
          {stale ? t("unknownBadge") : agentOnline ? t("agentBadge") : t("noAgentBadge")}
        </span>
      </header>
      <p className="studio-card-address">
        {workstation.ip}
        <span>•</span>
        {t(statusLabel)}
      </p>
      <div className={`studio-desktop ${preview ? "has-preview" : online && !stale ? "available" : ""}`} aria-label={t(preview ? "lastRemotePreview" : "desktopPreviewUnavailable")}>
        {preview
          ? <img className="studio-desktop-image" src={preview} alt="" aria-hidden="true" />
          : <div className="studio-desktop-grid" aria-hidden="true" />}
        {preview && <div className="studio-desktop-shade" aria-hidden="true" />}
        <div className="studio-desktop-details">
          <div className="studio-screen-symbol"><StudioIcon name="monitor" /></div>
          <strong>{metrics?.hostname || workstation.hostname}</strong>
          <span>{metrics?.os || workstation.os || t("studioWorkstation")}</span>
          <small>{t(preview ? "lastRemotePreview" : "desktopPreviewUnavailable")}</small>
        </div>
      </div>
      <div className="studio-card-metrics">
        <MetricBar label={t("cpuLabel")} value={metrics?.cpu?.utilizationPercent} />
        <MetricBar label={t("ramLabel")} value={metrics?.memory?.usagePercent} />
        {gpus.length
          ? gpus.map((gpu) => (
              <MetricBar key={gpu.index} label={gpus.length > 1 ? t("gpuIndexLabel", { index: gpu.index }) : t("gpuLabel")} value={gpu.utilizationPercent} />
            ))
          : <MetricBar label={t("gpuLabel")} value={undefined} />}
        {gpus.length
          ? gpus.map((gpu) => (
              <div className="studio-vram" key={`vram-${gpu.index}`} title={gpu.name}>
                <span>{gpus.length > 1 ? t("vramIndexLabel", { index: gpu.index }) : t("vramLabel")}</span>
                <span>
                  {(gpu.vramUsedMb / 1024).toFixed(1)} / {(gpu.vramTotalMb / 1024).toFixed(0)} GB
                  {gpu.temperatureCelsius != null && ` · ${gpu.temperatureCelsius}°C`}
                </span>
              </div>
            ))
          : (
              <div className="studio-vram">
                <span>{t("vramLabel")}</span>
                <span>—</span>
              </div>
            )}
      </div>
      {metrics?.processes?.some((process) => process.running) && (
        <div className="studio-apps" aria-label="Running applications">
          {metrics.processes
            .filter((process) => process.running)
            .map((process) => (
              <span key={process.name} title={process.ramMb != null ? `${process.ramMb} MB RAM` : undefined}>
                <span className="studio-dot online" />
                {process.name}
              </span>
            ))}
        </div>
      )}
      <div className="studio-card-actions">
        {online && !stale ? (
          <Link className="studio-button primary" to={`/remote/${workstation.id}`}>
            <StudioIcon name="monitor" />
            {t("remoteButton")}
          </Link>
        ) : (
          <button
            className="studio-button"
            onClick={handleWake}
            disabled={waking || stale || !status || !workstation.enabled || workstation.mac_address === "00:00:00:00:00:00"}
            title={workstation.mac_address === "00:00:00:00:00:00" ? t("macRequiredForWake") : undefined}
          >
            <StudioIcon name="power" />
            {waking ? t("sending") : t("wakeMachine")}
          </button>
        )}
        <Link className="studio-button secondary" to={`/workstations/${workstation.id}`}>
          {t("detailsButton")}
        </Link>
      </div>
      {message && (
        <p className="studio-card-message" role="status">
          {message}
        </p>
      )}
      <footer className="studio-card-footer">
        <StudioIcon name="clock" />
        <span>{t("uptimeLabel", { value: uptime(metrics?.uptimeSeconds) })}</span>
      </footer>
    </article>
  );
}
