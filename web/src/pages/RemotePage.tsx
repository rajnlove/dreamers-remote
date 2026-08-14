import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getWorkstation } from "../api/workstations";
import type { Workstation } from "../types/workstation";

export default function RemotePage() {
  const { id } = useParams<{ id: string }>();
  const [workstation, setWorkstation] = useState<Workstation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getWorkstation(Number(id))
      .then(setWorkstation)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  return (
    <div className="app">
      <header className="header">
        <Link className="back-link" to="/">
          &larr; WORKSTATIONS
        </Link>
        <h1>{workstation ? workstation.name : "REMOTE"}</h1>
      </header>

      <div className="empty">
        {error && <p className="error">{error}</p>}
        {!error && !workstation && <p>Đang tải...</p>}
        {workstation && (
          <p>
            Trình xem noVNC tích hợp sẽ có ở Milestone 4. Hiện tại có thể remote thủ công vào{" "}
            <strong>{workstation.name}</strong> ({workstation.ip}) qua noVNC đã deploy riêng cho
            máy này.
          </p>
        )}
      </div>
    </div>
  );
}
