const base = "/upload/api";
let csrf = "";
export function setCsrf(value: string) { csrf = value; }
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, { method, credentials: "same-origin", signal: AbortSignal.timeout(45_000),
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({ error: "Máy chủ tạm thời không phản hồi. Hãy thử lại." }));
  if (!response.ok) throw new ApiError(response.status, data.error ?? "Yêu cầu thất bại.");
  return data as T;
}
export interface Upload {
  id: string; name: string; size: number; offset: number; fingerprint: string;
  preset: string; state: "uploading" | "ready" | "submitting" | "submitted";
  jobId: number | null; createdAt: number; updatedAt: number;
}
export interface Job { id: number; status: string; progress: number; fps: number | null; etaSeconds: number | null; error: string | null }
export interface User { username: string; csrf: string; chunkBytes: number; maxFileBytes: number; quotaBytes: number; incompleteTtlHours: number }

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, "0")).join("");
export async function identify(file: File, chunkBytes: number, signal: AbortSignal, progress: (value: number) => void) {
  const hashes: string[] = [];
  // Hash on the user's computer, one bounded chunk at a time. Never load the entire file into RAM.
  for (let offset = 0; offset < file.size; offset += chunkBytes) {
    signal.throwIfAborted();
    hashes.push(hex(await crypto.subtle.digest("SHA-256", await file.slice(offset, offset + chunkBytes).arrayBuffer())));
    progress(Math.min(1, (offset + chunkBytes) / file.size));
  }
  const fingerprint = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${file.size}:${chunkBytes}:${hashes.join(":")}`)));
  return { hashes, fingerprint };
}
export function chunk(upload: Upload, file: File, chunkBytes: number, checksum: string, signal: AbortSignal, progress: (loaded: number) => void) {
  return new Promise<Upload>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const done = () => signal.removeEventListener("abort", abort);
    if (signal.aborted) { reject(new DOMException("Paused", "AbortError")); return; }
    xhr.open("PUT", `${base}/uploads/${upload.id}/chunk`);
    xhr.timeout = 95_000;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-CSRF-Token", csrf);
    xhr.setRequestHeader("Upload-Offset", String(upload.offset));
    xhr.setRequestHeader("Upload-Checksum", checksum);
    xhr.upload.onprogress = event => progress(event.loaded);
    xhr.onload = () => {
      done();
      let data: Upload & { error?: string };
      try { data = JSON.parse(xhr.responseText); } catch { reject(new ApiError(xhr.status || 503, "Máy chủ tạm thời không phản hồi.")); return; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data.error ?? "Upload bị gián đoạn."));
    };
    xhr.onerror = xhr.ontimeout = () => { done(); reject(new ApiError(0, "Mất kết nối khi upload.")); };
    xhr.onabort = () => { done(); reject(new DOMException("Paused", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(file.slice(upload.offset, upload.offset + chunkBytes));
  });
}
export function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const cancel = () => { clearTimeout(timer); reject(new DOMException("Paused", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}
