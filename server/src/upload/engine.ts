import type { UploadConfig } from "./config.js";
import type { Job } from "../job/types.js";

export interface Engine {
  create(key: string, input: Record<string, unknown>, provenance?: Record<string, unknown>): Promise<Job>;
  get(id: number): Promise<Job>;
  cancel(id: number): Promise<Job>;
}
export class EngineClient implements Engine {
  private cookie = "";
  private loginPromise: Promise<void> | null = null;
  constructor(private config: UploadConfig) {}
  private async login() {
    if (!this.loginPromise) this.loginPromise = (async () => {
      const response = await fetch(`${this.config.engineUrl}/api/auth/login`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: this.config.engineUsername, password: this.config.enginePassword }),
      });
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      if (!response.ok || !cookie) throw new Error("Engine authentication unavailable");
      this.cookie = cookie;
    })().finally(() => { this.loginPromise = null; });
    return this.loginPromise;
  }
  private async request(route: string, method = "GET", body?: unknown, key?: string): Promise<Job> {
    if (!this.cookie) await this.login();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(`${this.config.engineUrl}/api/jobs${route}`, {
        method, redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { Cookie: this.cookie, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status === 401 && attempt === 0) { await this.login(); continue; }
      if (!response.ok) throw new Error(`Engine response ${response.status}`);
      const job = await response.json() as Job;
      if (!Number.isInteger(job.id) || job.id <= 0) throw new Error("Invalid engine response");
      return job;
    }
    throw new Error("Engine unavailable");
  }
  // `provenance` is audit metadata the Job Engine records as-is; it
  // grants nothing (the engine's own service-account session is what
  // authorizes this call). It must stay byte-identical across retries
  // of the same idempotency key, or the engine rejects the replay as a
  // different request -- so callers derive it from stored upload fields,
  // never from the current clock.
  create(key: string, input: Record<string, unknown>, provenance?: Record<string, unknown>) {
    return this.request("", "POST", { type: "ffmpeg", priority: 0, input: JSON.stringify(input),
      required_software: { upload_input_safety: "1" }, origin: "website_project_upload", provenance }, key);
  }
  get(id: number) { return this.request(`/${id}`); }
  cancel(id: number) { return this.request(`/${id}/cancel`, "POST"); }
}
