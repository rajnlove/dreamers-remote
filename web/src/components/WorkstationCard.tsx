import { useState } from "react";
import { Link } from "react-router-dom";
import { wakeWorkstation } from "../api/workstations";
import type { Workstation } from "../types/workstation";

interface Props {
  workstation: Workstation;
  online: boolean | undefined;
}

export default function WorkstationCard({ workstation, online }: Props) {
  const [waking, setWaking] = useState(false);
  const dotClass = online === undefined ? "dot-unknown" : online ? "dot-online" : "dot-offline";
  const statusLabel = online === undefined ? "CHECKING..." : online ? "ONLINE" : "OFFLINE";

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
        <span className={`dot ${dotClass}`} />
        {workstation.name}
      </div>
      <p className="card-ip">
        {workstation.ip} &middot; {statusLabel}
      </p>
      <div className="card-actions">
        {online ? (
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
