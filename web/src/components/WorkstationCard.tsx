import { Link } from "react-router-dom";
import type { Workstation } from "../types/workstation";

interface Props {
  workstation: Workstation;
  online: boolean | undefined;
}

export default function WorkstationCard({ workstation, online }: Props) {
  const dotClass = online === undefined ? "dot-unknown" : online ? "dot-online" : "dot-offline";
  const statusLabel = online === undefined ? "CHECKING..." : online ? "ONLINE" : "OFFLINE";

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
          <button
            className="btn"
            onClick={() => alert("Wake-on-LAN chưa được triển khai (Milestone 5).")}
          >
            WAKE
          </button>
        )}
      </div>
    </div>
  );
}
