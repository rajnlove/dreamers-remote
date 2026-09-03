import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import RFB from "@novnc/novnc";
import { getWorkstation } from "../api/workstations";
import { WS_BASE_URL } from "../api/config";
import type { Workstation } from "../types/workstation";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/translations";
import { saveRemotePreview } from "../remotePreview";

type ConnState = "connecting" | "connected" | "disconnected";
// "fit": whole framebuffer (all monitors, if the workstation has more than
// one) scaled to fit the viewport — readable at a glance, but multi-monitor
// desktops get squashed too small to click precisely.
// "actual": native resolution. noVNC's own screen container is already a
// plain scrollable div (overflow: auto) whenever the canvas is bigger than
// it — turning scaleViewport off is enough to get that for free, so panning
// is native browser scroll (wheel/trackpad/scrollbar), not a custom drag
// gesture. Deliberately NOT using noVNC's clipViewport/dragViewport option:
// that path re-implements panning via canvas redraws and, when it doesn't
// work, leaves you with a zoomed view and no way to reach the rest — worse
// than just not having the feature. Native scroll can't have that failure
// mode. Bonus: plain click-drag on the canvas still goes straight to the
// remote session, unlike dragViewport mode which hijacks it for panning.
type ZoomMode = "fit" | "actual";

function applyZoomMode(rfb: RFB, mode: ZoomMode): void {
  rfb.scaleViewport = mode === "fit";
}

export default function RemotePage({ username }: { username: string }) {
  const { id } = useParams<{ id: string }>();
  const { t } = useLanguage();
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

    const screen = screenRef.current;
    const rfb = new RFB(screen, `${WS_BASE_URL}/ws/vnc/${id}`);
    applyZoomMode(rfb, zoomModeRef.current);
    rfb.resizeSession = false;
    // LAN, not internet: bandwidth is cheap, CPU-bound compression is the
    // real latency cost. Favor quality and skip zlib work UltraVNC/noVNC
    // would otherwise spend on a link that doesn't need it.
    rfb.qualityLevel = 9;
    rfb.compressionLevel = 1;
    rfbRef.current = rfb;

    let connected = false;
    let framebuffer: HTMLCanvasElement | null = null;
    const capture = () => {
      if (!connected) return;
      framebuffer = screen.querySelector("canvas") ?? framebuffer;
      if (framebuffer) saveRemotePreview(username, Number(id), framebuffer);
    };
    const onConnect = () => {
      connected = true;
      framebuffer = screen.querySelector("canvas");
      setConnState("connected");
    };
    const onDisconnect = () => {
      capture();
      connected = false;
      setConnState("disconnected");
    };
    // Also retain a recent frame if the browser/tab closes unexpectedly.
    const timer = window.setInterval(capture, 3000);
    const onVisibility = () => { if (document.hidden) capture(); };
    window.addEventListener("pagehide", capture);
    document.addEventListener("visibilitychange", onVisibility);
    const onCredentialsRequired = () => setNeedsPassword(true);

    rfb.addEventListener("connect", onConnect);
    rfb.addEventListener("disconnect", onDisconnect);
    rfb.addEventListener("credentialsrequired", onCredentialsRequired);

    return () => {
      capture();
      window.clearInterval(timer);
      window.removeEventListener("pagehide", capture);
      document.removeEventListener("visibilitychange", onVisibility);
      rfb.removeEventListener("connect", onConnect);
      rfb.removeEventListener("disconnect", onDisconnect);
      rfb.removeEventListener("credentialsrequired", onCredentialsRequired);
      rfb.disconnect();
      rfbRef.current = null;
    };
  }, [id, reconnectKey, username]);

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

  const connStateKey: Record<ConnState, TranslationKey> = {
    connecting: "connStateConnecting",
    connected: "connStateConnected",
    disconnected: "connStateDisconnected",
  };

  return (
    <div className="app remote-app">
      <header className="header remote-header">
        <div>
          <Link className="back-link" to="/">
            &larr; {t("backToWorkstations")}
          </Link>
          <h1>{workstation ? workstation.name : t("remoteHeadingFallback")}</h1>
        </div>
        <div className="remote-toolbar">
          <span className={`status-pill status-${connState}`}>{t(connStateKey[connState])}</span>
          <button className="btn" onClick={handleCtrlAltDel} disabled={connState !== "connected"}>
            {t("ctrlAltDel")}
          </button>
          <button className="btn" onClick={handleFullscreen}>
            {t("fullscreen")}
          </button>
          <button className="btn" onClick={handleToggleZoom} title={t("zoomActualHint")}>
            {zoomMode === "fit" ? t("zoomActualLabel") : t("zoomFitLabel")}
          </button>
          {connState === "connected" ? (
            <button className="btn" onClick={handleDisconnect}>
              {t("disconnect")}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleReconnect}>
              {t("reconnect")}
            </button>
          )}
        </div>
      </header>

      {loadError && <div className="error">{loadError}</div>}

      <div className="remote-screen" ref={screenRef} />

      {needsPassword && (
        <div className="password-overlay">
          <form className="password-form" onSubmit={submitPassword}>
            <label htmlFor="vnc-password">{t("vncPassword")}</label>
            <input
              id="vnc-password"
              type="password"
              autoFocus
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
            />
            <button className="btn btn-primary" type="submit">
              {t("connect")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
