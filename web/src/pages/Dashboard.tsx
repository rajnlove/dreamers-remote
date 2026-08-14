import { useEffect, useState } from "react";
import WorkstationCard from "../components/WorkstationCard";
import { getWorkstationsStatus, listWorkstations } from "../api/workstations";
import type { Workstation } from "../types/workstation";

const STATUS_POLL_MS = 5000;

export default function Dashboard() {
  const [workstations, setWorkstations] = useState<Workstation[] | null>(null);
  const [statusById, setStatusById] = useState<Map<number, boolean>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listWorkstations()
      .then(setWorkstations)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function pollStatus() {
      try {
        const results = await getWorkstationsStatus();
        if (cancelled) return;
        setStatusById(new Map(results.map((r) => [r.id, r.online])));
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    pollStatus();
    const interval = setInterval(pollStatus, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1>DREAMERS REMOTE</h1>
      </header>

      <div className="section-title">WORKSTATIONS</div>

      {error && <div className="error">Không kết nối được backend: {error}</div>}

      {workstations === null && !error && <div className="empty">Đang tải...</div>}

      {workstations !== null && workstations.length === 0 && (
        <div className="empty">Chưa có workstation nào được đăng ký.</div>
      )}

      {workstations !== null && workstations.length > 0 && (
        <div className="grid">
          {workstations.map((ws) => (
            <WorkstationCard key={ws.id} workstation={ws} online={statusById.get(ws.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
