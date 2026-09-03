import { useState } from "react";
import { Link } from "react-router-dom";
import { wakeWorkstation } from "../api/workstations";
import type { Workstation, WorkstationStatus } from "../types/workstation";
import StudioIcon from "./StudioIcon";

interface Props {
  workstation: Workstation;
  status: WorkstationStatus | undefined;
  stale?: boolean;
}

function MetricBar({ label, value }: { label: string; value: number | null | undefined }) {
  const available = value != null && Number.isFinite(value);
  return (
    <div className="studio-metric">
      <span>{label}</span>
      <div className="studio-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={available ? Math.max(0, Math.min(100, value)) : undefined} aria-valuetext={available ? `${Math.round(value)}%` : "Unavailable"}>
        <span style={{ width: `${available ? Math.max(0, Math.min(100, value)) : 0}%` }} />
      </div>
      <strong>{available ? `${Math.round(value)}%` : "—"}</strong>
    </div>
  );
}

function uptime(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "Unavailable";
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return `${Math.floor(minutes / 1440)}d ${Math.floor(minutes / 60) % 24}h ${minutes % 60}m`;
}

export default function WorkstationCard({ workstation, status, stale = false }: Props) {
  const [waking, setWaking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const online = status?.vncOnline && workstation.enabled;
  const agentOnline = status?.agentOnline && !stale;
  const metrics = agentOnline ? status?.metrics : null;
  const statusLabel = !workstation.enabled ? "DISABLED" : stale ? "UNKNOWN" : !status ? "CHECKING" : online ? "ONLINE" : "OFFLINE";
  const gpus = metrics?.gpus ?? [];

  async function handleWake() {
    setWaking(true);
    setMessage(null);
    try {
      await wakeWorkstation(workstation.id);
      setMessage("Wake signal sent. Waiting for the machine to come online.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally { setWaking(false); }
  }

  return (
    <article className="studio-workstation" aria-label={workstation.name}>
      <header className="studio-card-header">
        <span className={`studio-dot ${statusLabel === "ONLINE" ? "online" : statusLabel === "OFFLINE" || statusLabel === "DISABLED" ? "offline" : "unknown"}`} title={`Remote: ${statusLabel}`} />
        <Link to={`/workstations/${workstation.id}`} className="studio-card-name">{workstation.name}</Link>
        <span className={`studio-agent ${agentOnline ? "online" : ""}`} title={stale ? "Agent status unavailable" : status?.agentOnline ? "Agent online" : "Agent offline or not paired"}>{stale ? "UNKNOWN" : agentOnline ? "AGENT" : "NO AGENT"}</span>
      </header>
      <p className="studio-card-address">{workstation.ip}<span>•</span>{statusLabel}</p>
      <div className={`studio-desktop ${online && !stale ? "available" : ""}`} aria-label="Workstation information; desktop preview unavailable">
        <div className="studio-desktop-grid" aria-hidden="true" />
        <div className="studio-screen-symbol"><StudioIcon name="monitor" /></div>
        <strong>{metrics?.hostname || workstation.hostname}</strong>
        <span>{metrics?.os || workstation.os || "Studio workstation"}</span>
        <small>Desktop preview unavailable</small>
      </div>
      <div className="studio-card-metrics">
        <MetricBar label="CPU" value={metrics?.cpu?.utilizationPercent} />
        <MetricBar label="RAM" value={metrics?.memory?.usagePercent} />
        {gpus.length ? gpus.map(gpu => <MetricBar key={gpu.index} label={gpus.length > 1 ? `GPU ${gpu.index}` : "GPU"} value={gpu.utilizationPercent} />) : <MetricBar label="GPU" value={undefined} />}
        {gpus.length ? gpus.map(gpu => <div className="studio-vram" key={`vram-${gpu.index}`} title={gpu.name}><span>{gpus.length > 1 ? `VRAM ${gpu.index}` : "VRAM"}</span><span>{(gpu.vramUsedMb / 1024).toFixed(1)} / {(gpu.vramTotalMb / 1024).toFixed(0)} GB{gpu.temperatureCelsius != null && ` · ${gpu.temperatureCelsius}°C`}</span></div>) : <div className="studio-vram"><span>VRAM</span><span>—</span></div>}
      </div>
      {metrics?.processes?.some(process => process.running) && <div className="studio-apps" aria-label="Running applications">{metrics.processes.filter(process => process.running).map(process => <span key={process.name} title={process.ramMb != null ? `${process.ramMb} MB RAM` : undefined}><span className="studio-dot online" />{process.name}</span>)}</div>}
      <div className="studio-card-actions">
        {online && !stale ? <Link className="studio-button primary" to={`/remote/${workstation.id}`}><StudioIcon name="monitor" />REMOTE</Link> : <button className="studio-button" onClick={handleWake} disabled={waking || stale || !status || !workstation.enabled || workstation.mac_address === "00:00:00:00:00:00"} title={workstation.mac_address === "00:00:00:00:00:00" ? "Set a MAC address before using Wake-on-LAN" : undefined}><StudioIcon name="power" />{waking ? "SENDING…" : "WAKE MACHINE"}</button>}
        <Link className="studio-button secondary" to={`/workstations/${workstation.id}`}>DETAILS</Link>
      </div>
      {message && <p className="studio-card-message" role="status">{message}</p>}
      <footer className="studio-card-footer"><StudioIcon name="clock" /><span>Uptime: {uptime(metrics?.uptimeSeconds)}</span></footer>
    </article>
  );
}
