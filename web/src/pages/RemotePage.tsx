import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import RFB from "@novnc/novnc";
import { getWorkstation } from "../api/workstations";
import { WS_BASE_URL } from "../api/config";
import type { Workstation } from "../types/workstation";

type ConnState = "connecting" | "connected" | "disconnected";
// "fit": whole framebuffer (all monitors, if the workstation has more than
// one) scaled to fit the viewport — readable at a glance, but multi-monitor
// desktops get squashed too small to click precisely.
// "actual": native resolution, drag to pan — legible on multi-monitor
// setups at the cost of not seeing everything at once.
type ZoomMode = "fit" | "actual";

function applyZoomMode(rfb: RFB, mode: ZoomMode): void {
  rfb.scaleViewport = mode === "fit";
  rfb.clipViewport = mode === "actual";
  rfb.dragViewport = mode === "actual";
}

export default function RemotePage() {
  const { id } = useParams<{ id: string }>();
  const [workstation, setWorkstation] = useState<Workstation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connState, setConnState] = useState<ConnState>("connecting");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit");

  const screenRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const zoomModeRef = useRef<ZoomMode>(zoomMode);
  const [reconnectKey, setReconnectKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    getWorkstation(Number(id))
      .then(setWorkstation)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  useEffect(() => {
    if (!id || !screenRef.current) return;

    setConnState("connecting");
    setNeedsPassword(false);

    const rfb = new RFB(screenRef.current, `${WS_BASE_URL}/ws/vnc/${id}`);
    applyZoomMode(rfb, zoomModeRef.current);
    rfb.resizeSession = false;
    // LAN, not internet: bandwidth is cheap, CPU-bound compression is the
    // real latency cost. Favor quality and skip zlib work UltraVNC/noVNC
    // would otherwise spend on a link that doesn't need it.
    rfb.qualityLevel = 9;
    rfb.compressionLevel = 1;
    rfbRef.current = rfb;

    const onConnect = () => setConnState("connected");
    const onDisconnect = () => setConnState("disconnected");
    const onCredentialsRequired = () => setNeedsPassword(true);

    rfb.addEventListener("connect", onConnect);
    rfb.addEventListener("disconnect", onDisconnect);
    rfb.addEventListener("credentialsrequired", onCredentialsRequired);

    return () => {
      rfb.removeEventListener("connect", onConnect);
      rfb.removeEventListener("disconnect", onDisconnect);
      rfb.removeEventListener("credentialsrequired", onCredentialsRequired);
      rfb.disconnect();
      rfbRef.current = null;
    };
  }, [id, reconnectKey]);

  function submitPassword(e: FormEvent) {
    e.preventDefault();
    rfbRef.current?.sendCredentials({ password: passwordInput });
    setNeedsPassword(false);
    setPasswordInput("");
  }

  function handleReconnect() {
    setReconnectKey((k) => k + 1);
  }

  function handleDisconnect() {
    rfbRef.current?.disconnect();
  }

  function handleCtrlAltDel() {
    rfbRef.current?.sendCtrlAltDel();
  }

  function handleFullscreen() {
    screenRef.current?.requestFullscreen();
  }

  function handleToggleZoom() {
    setZoomMode((prev) => {
      const next: ZoomMode = prev === "fit" ? "actual" : "fit";
      zoomModeRef.current = next;
      if (rfbRef.current) applyZoomMode(rfbRef.current, next);
      return next;
    });
  }

  return (
    <div className="app remote-app">
      <header className="header remote-header">
        <div>
          <Link className="back-link" to="/">
            &larr; WORKSTATIONS
          </Link>
          <h1>{workstation ? workstation.name : "REMOTE"}</h1>
        </div>
        <div className="remote-toolbar">
          <span className={`status-pill status-${connState}`}>{connState.toUpperCase()}</span>
          <button className="btn" onClick={handleCtrlAltDel} disabled={connState !== "connected"}>
            CTRL+ALT+DEL
          </button>
          <button className="btn" onClick={handleFullscreen}>
            FULLSCREEN
          </button>
          <button
            className="btn"
            onClick={handleToggleZoom}
            title="Multi-monitor desktops: switch to 100% and drag to pan"
          >
            {zoomMode === "fit" ? "100% (DRAG TO PAN)" : "FIT TO SCREEN"}
          </button>
          {connState === "connected" ? (
            <button className="btn" onClick={handleDisconnect}>
              DISCONNECT
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleReconnect}>
              RECONNECT
            </button>
          )}
        </div>
      </header>

      {loadError && <div className="error">{loadError}</div>}

      <div className="remote-screen" ref={screenRef} />

      {needsPassword && (
        <div className="password-overlay">
          <form className="password-form" onSubmit={submitPassword}>
            <label htmlFor="vnc-password">VNC PASSWORD</label>
            <input
              id="vnc-password"
              type="password"
              autoFocus
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
            />
            <button className="btn btn-primary" type="submit">
              CONNECT
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
