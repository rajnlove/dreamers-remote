import { useSyncExternalStore } from "react";
import { API_BASE_URL } from "./api/config";

const prefix = "dreamers-remote-preview:";
const changed = "dreamers-preview-changed";
const keyFor = (username: string, id: number) => `${prefix}${JSON.stringify([API_BASE_URL, username, id])}`;

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(changed, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(changed, listener);
  };
}

export function useRemotePreview(username: string, id: number) {
  return useSyncExternalStore(subscribe, () => read(keyFor(username, id)), () => null);
}

// Best effort: thumbnail storage must never interrupt the remote session.
export function saveRemotePreview(username: string, id: number, source: HTMLCanvasElement) {
  if (source.width < 100 || source.height < 100) return;
  try {
    const scale = Math.min(1, 640 / source.width, 360 / source.height);
    const thumbnail = document.createElement("canvas");
    thumbnail.width = Math.max(1, Math.round(source.width * scale));
    thumbnail.height = Math.max(1, Math.round(source.height * scale));
    const context = thumbnail.getContext("2d");
    if (!context) return;
    context.drawImage(source, 0, 0, thumbnail.width, thumbnail.height);
    const data = thumbnail.toDataURL("image/jpeg", 0.7);
    const key = keyFor(username, id);
    if (read(key) === data) return;
    // Bound storage to the 24 most recently captured workstations.
    const keys = Object.keys(localStorage).filter(item => item.startsWith(prefix));
    if (!keys.includes(key) && keys.length >= 24) localStorage.removeItem(keys[0]);
    localStorage.setItem(key, data);
    window.dispatchEvent(new Event(changed));
  } catch { /* Storage disabled/full or framebuffer unavailable: keep the last thumbnail. */ }
}
