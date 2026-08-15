import { useState } from "react";
import { Link } from "react-router-dom";
import { wakeWorkstation } from "../api/workstations";
import type { Workstation, WorkstationStatus } from "../types/workstation";

interface Props {
  workstation: Workstation;
  status: WorkstationStatus | undefined;
}

function MetricBar({ label, percent, text }: { label: string; percent: number; text: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="metric-row">
      <span className="metric-label">{label}</span>
      <div className="metric-bar">
        <div className="metric-bar-fill" style={{ width: `${clamped}%` }} />
      </div>
      <span className="metric-value">{text}</span>
    </div>
  );
}

export default function WorkstationCard({ workstation, status }: Props) {
  const [waking, setWaking] = useState(false);

  const vncOnline = status?.vncOnline;
  const agentOnline = status?.agentOnline ?? false;
  const metrics = agentOnline ? status?.metrics : undefined;

  const dotClass = vncOnline === undefined ? "dot-unknown" : vncOnline ? "dot-online" : "dot-offline";
  const statusLabel = vncOnline === undefined ? "CHECKING..." : vncOnline ? "ONLINE" : "OFFLINE";

  async function handleWake() {
    setWaking(true);
    try {
      await wakeWorkstation(workstation.id);
      alert(`Đã gửi Wake-on-LAN packet tới ${workstation.name}. Máy có thể mất một lúc để khởi động.`);
    } catch (err) {
      alert(`Gửi Wake-on-LAN thất bại: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setWaking(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title">
        <span className={`dot ${dotClass}`} title={`VNC: ${statusLabel}`} />
        <Link className="card-title-link" to={`/workstations/${workstation.id}`}>
          {workstation.name}
        </Link>
        <span
          className={`agent-badge ${agentOnline ? "agent-badge-online" : "agent-badge-offline"}`}
          title={agentOnline ? "Agent: ONLINE" : "Agent: OFFLINE hoặc chưa cài"}
        >
          AGENT
        </span>
      </div>
      <p className="card-ip">
        {workstation.ip} &middot; {statusLabel}
      </p>

      {metrics && (
        <div className="metrics">
          {metrics.cpu && (
            <MetricBar
              label="CPU"
              percent={metrics.cpu.utilizationPercent ?? 0}
              text={metrics.cpu.utilizationPercent === null ? "..." : `${Math.round(metrics.cpu.utilizationPercent)}%`}
            />
          )}
          {metrics.memory && (
            <MetricBar
              label="RAM"
              percent={metrics.memory.usagePercent}
              text={`${Math.round(metrics.memory.usagePercent)}%`}
            />
          )}
          {metrics.gpus?.map((gpu) => (
            <MetricBar
              key={gpu.index}
              label={metrics.gpus!.length > 1 ? `GPU${gpu.index}` : "GPU"}
              percent={gpu.utilizationPercent}
              text={`${Math.round(gpu.utilizationPercent)}%`}
            />
          ))}
          {metrics.gpus?.map((gpu) => (
            <div className="metric-row" key={`vram-${gpu.index}`}>
              <span className="metric-label">VRAM</span>
              <span className="metric-value metric-value-wide">
                {(gpu.vramUsedMb / 1024).toFixed(1)} / {(gpu.vramTotalMb / 1024).toFixed(0)} GB
                {gpu.temperatureCelsius !== null && ` · ${gpu.temperatureCelsius}°C`}
              </span>
            </div>
          ))}

          {metrics.processes && metrics.processes.some((p) => p.running) && (
            <div className="apps">
              {metrics.processes
                .filter((p) => p.running)
                .map((p) => (
                  <div className="app-row" key={p.name}>
                    <span className="dot dot-online" />
                    {p.name}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      <div className="card-actions">
        {vncOnline ? (
          <Link className="btn btn-primary" to={`/remote/${workstation.id}`}>
            REMOTE
          </Link>
        ) : (
          <button className="btn" onClick={handleWake} disabled={waking}>
            {waking ? "SENDING..." : "WAKE"}
          </button>
        )}
      </div>
    </div>
  );
}
