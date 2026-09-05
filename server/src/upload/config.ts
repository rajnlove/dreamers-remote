import path from "node:path";

export interface UploadConfig {
  origin: string; root: string; database: string; workerRoot: string;
  engineUrl: string; engineUsername: string; enginePassword: string;
  username: string; password: string; port: number;
  chunkBytes: number; maxFileBytes: number; quotaBytes: number; reserveBytes: number;
  maxActive: number; maxTransfers: number; ttlMs: number; staticRoot: string;
}
export function uploadConfig(): UploadConfig {
  const required = (key: string) => {
    const value = process.env[key];
    if (!value) throw new Error(`${key} is required for the upload portal`);
    return value;
  };
  const number = (key: string, fallback: number, min: number, max: number) => {
    const value = Number(process.env[key] ?? fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
    return value;
  };
  const origin = new URL(required("UPLOAD_PUBLIC_ORIGIN"));
  if (origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password ||
      (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)))) {
    throw new Error("UPLOAD_PUBLIC_ORIGIN must be an HTTPS origin (HTTP allowed on localhost for development only)");
  }
  const password = required("UPLOAD_PASSWORD");
  if (password.length < 16) throw new Error("UPLOAD_PASSWORD must contain at least 16 characters");
  const workerRoot = required("UPLOAD_WORKER_ROOT").replace(/\\+$/, "");
  if (!/^\\\\[^\\]+\\[^\\]+/.test(workerRoot) || workerRoot.includes("..")) throw new Error("UPLOAD_WORKER_ROOT must be a UNC folder");
  const engineUrl = new URL(required("UPLOAD_ENGINE_URL"));
  if (!["http:", "https:"].includes(engineUrl.protocol) || engineUrl.username || engineUrl.password || engineUrl.pathname !== "/") throw new Error("Invalid UPLOAD_ENGINE_URL");
  return {
    origin: origin.origin, root: path.resolve(required("UPLOAD_STORAGE_ROOT")),
    database: process.env.UPLOAD_DATABASE_FILE ?? "/data/upload.sqlite",
    workerRoot, engineUrl: engineUrl.origin,
    engineUsername: required("UPLOAD_ENGINE_USERNAME"), enginePassword: required("UPLOAD_ENGINE_PASSWORD"),
    username: required("UPLOAD_USERNAME"), password,
    port: number("UPLOAD_PORT", 8090, 1024, 65535),
    chunkBytes: 4 * 1024 * 1024,
    maxFileBytes: number("UPLOAD_MAX_FILE_GB", 20, 1, 1024) * 1024 ** 3,
    quotaBytes: number("UPLOAD_QUOTA_GB", 100, 1, 8192) * 1024 ** 3,
    reserveBytes: number("UPLOAD_DISK_RESERVE_GB", 10, 1, 1024) * 1024 ** 3,
    maxActive: number("UPLOAD_MAX_ACTIVE", 4, 1, 20),
    maxTransfers: number("UPLOAD_MAX_TRANSFERS", 2, 1, 4),
    ttlMs: number("UPLOAD_INCOMPLETE_TTL_HOURS", 48, 1, 168) * 3600_000,
    staticRoot: path.resolve(process.env.UPLOAD_STATIC_ROOT ?? "public"),
  };
}
