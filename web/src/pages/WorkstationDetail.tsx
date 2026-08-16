import { Fragment, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getWorkstation, getWorkstationMetrics, sendAgentCommand, type AgentCommand } from "../api/workstations";
import type { Workstation, WorkstationStatus } from "../types/workstation";

const POLL_MS = 5000;

function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatLastSeen(iso: string | null): string {
  if (!iso) return "Chưa bao giờ";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s trước`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m trước`;
  return `${Math.floor(seconds / 3600)}h trước`;
}

export default function WorkstationDetail() {
  const { id } = useParams<{ id: string }>();
  const [workstation, setWorkstation] = useState<Workstation | null>(null);
  const [status, setStatus] = useState<WorkstationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCommand, setConfirmCommand] = useState<AgentCommand | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandMessage, setCommandMessage] = useState<string | null>(null);

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
      setCommandMessage(
        `Đã gửi lệnh ${command.toUpperCase()} — máy sẽ thực hiện trong lần heartbeat tiếp theo (tối đa ~5s).`,
      );
    } catch (err) {
      setCommandMessage(`Gửi lệnh thất bại: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCommandBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="header remote-header">
        <div>
          <Link className="back-link" to="/">
            &larr; WORKSTATIONS
          </Link>
          <h1>{workstation ? workstation.name : "..."}</h1>
        </div>
        <div className="remote-toolbar">
          {status?.vncOnline && (
            <Link className="btn btn-primary" to={`/remote/${id}`}>
              REMOTE
            </Link>
          )}
          <button
            className="btn"
            disabled={!status?.agentOnline || commandBusy}
            title={status?.agentOnline ? undefined : "Agent chưa online — không gửi được lệnh"}
            onClick={() => setConfirmCommand("restart")}
          >
            RESTART
          </button>
          <button
            className="btn"
            disabled={!status?.agentOnline || commandBusy}
            title={status?.agentOnline ? undefined : "Agent chưa online — không gửi được lệnh"}
            onClick={() => setConfirmCommand("shutdown")}
          >
            SHUTDOWN
          </button>
        </div>
      </header>

      {error && <div className="error">{error}</div>}
      {commandMessage && <div className="notice">{commandMessage}</div>}

      {workstation && (
        <div className="detail-body">
          <section className="detail-section">
            <h2>OVERVIEW</h2>
            <div className="detail-grid">
              <span className="detail-label">Hostname</span>
              <span>{metrics?.hostname ?? workstation.hostname}</span>
              <span className="detail-label">IP</span>
              <span>{workstation.ip}</span>
              <span className="detail-label">OS</span>
              <span>{metrics?.os ?? workstation.os ?? "—"}</span>
              <span className="detail-label">Agent version</span>
              <span>{metrics?.agentVersion ?? "—"}</span>
              <span className="detail-label">Uptime</span>
              <span>{metrics?.uptimeSeconds !== undefined ? formatUptime(metrics.uptimeSeconds) : "—"}</span>
              <span className="detail-label">Last seen</span>
              <span>{formatLastSeen(status?.lastSeen ?? null)}</span>
              <span className="detail-label">VNC</span>
              <span>{status?.vncOnline ? "ONLINE" : "OFFLINE"}</span>
              <span className="detail-label">Agent</span>
              <span>{status?.agentOnline ? "ONLINE" : "OFFLINE"}</span>
            </div>
          </section>

          {metrics?.cpu && (
            <section className="detail-section">
              <h2>CPU</h2>
              <div className="detail-grid">
                <span className="detail-label">Model</span>
                <span>{metrics.cpu.name}</span>
                <span className="detail-label">Cores</span>
                <span>
                  {metrics.cpu.physicalCoreCount} physical / {metrics.cpu.logicalProcessorCount} logical
                </span>
                <span className="detail-label">Usage</span>
                <span>
                  {metrics.cpu.utilizationPercent === null ? "…" : `${Math.round(metrics.cpu.utilizationPercent)}%`}
                </span>
              </div>
            </section>
          )}

          {metrics?.memory && (
            <section className="detail-section">
              <h2>RAM</h2>
              <div className="detail-grid">
                <span className="detail-label">Used</span>
                <span>{(metrics.memory.usedMb / 1024).toFixed(1)} GB</span>
                <span className="detail-label">Available</span>
                <span>{(metrics.memory.availableMb / 1024).toFixed(1)} GB</span>
                <span className="detail-label">Total</span>
                <span>{(metrics.memory.totalMb / 1024).toFixed(1)} GB</span>
              </div>
            </section>
          )}

          {metrics?.gpus && metrics.gpus.length > 0 && (
            <section className="detail-section">
              <h2>GPU</h2>
              {metrics.gpus.map((gpu) => (
                <div className="detail-grid detail-gpu" key={gpu.index}>
                  <span className="detail-label">GPU {gpu.index}</span>
                  <span>{gpu.name}</span>
                  <span className="detail-label">Usage</span>
                  <span>{Math.round(gpu.utilizationPercent)}%</span>
                  <span className="detail-label">VRAM</span>
                  <span>
                    {(gpu.vramUsedMb / 1024).toFixed(1)} / {(gpu.vramTotalMb / 1024).toFixed(0)} GB
                  </span>
                  <span className="detail-label">Temp</span>
                  <span>{gpu.temperatureCelsius !== null ? `${gpu.temperatureCelsius}°C` : "—"}</span>
                </div>
              ))}
            </section>
          )}

          {metrics?.disks && metrics.disks.length > 0 && (
            <section className="detail-section">
              <h2>STORAGE</h2>
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
              <h2>APPLICATIONS</h2>
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

          {!metrics && (
            <div className="empty">
              Agent chưa online — không có dữ liệu CPU/RAM/GPU/disk/apps để hiển thị.
            </div>
          )}
        </div>
      )}

      {confirmCommand && (
        <div className="password-overlay">
          <div className="password-form">
            <p>
              Bạn có chắc muốn <strong>{confirmCommand.toUpperCase()}</strong> máy{" "}
              <strong>{workstation?.name}</strong> không?
            </p>
            <div className="remote-toolbar">
              <button className="btn" onClick={() => setConfirmCommand(null)}>
                HỦY
              </button>
              <button className="btn btn-primary" onClick={confirmSendCommand}>
                XÁC NHẬN {confirmCommand.toUpperCase()}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
