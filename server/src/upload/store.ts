import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { UploadConfig } from "./config.js";

export class PortalError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export interface Upload {
  id: string; owner: string; name: string; size: number; offset: number;
  extension: string; fingerprint: string; preset: string; state: "uploading" | "ready" | "submitting" | "submitted";
  job_id: number | null; created_at: number; updated_at: number;
}
export const PRESETS = {
  review: { codec: "h264_nvenc", qualityMode: "cq", quality: 23, bitrate: null, preset: "p4", resolution: "1920x1080", audioCodec: "aac" },
  delivery: { codec: "h264_nvenc", qualityMode: "cq", quality: 18, bitrate: null, preset: "p5", resolution: null, audioCodec: "aac" },
  compact: { codec: "hevc_nvenc", qualityMode: "cq", quality: 24, bitrate: null, preset: "p5", resolution: null, audioCodec: "aac" },
} as const;

export class UploadStore {
  readonly db: Database.Database;
  constructor(readonly config: UploadConfig) {
    mkdirSync(path.dirname(config.database), { recursive: true });
    mkdirSync(config.root, { recursive: true });
    this.db = new Database(config.database);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS uploads (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL,
        offset INTEGER NOT NULL DEFAULT 0, extension TEXT NOT NULL, fingerprint TEXT NOT NULL,
        preset TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'uploading', job_id INTEGER,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS uploads_owner ON uploads(owner, created_at);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, owner TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
    `);
  }
  get(owner: string, id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new PortalError(404, "Không tìm thấy phiên upload.");
    const upload = this.db.prepare("SELECT * FROM uploads WHERE id = ? AND owner = ?").get(id, owner) as Upload | undefined;
    if (!upload) throw new PortalError(404, "Không tìm thấy phiên upload.");
    return upload;
  }
  list(owner: string) {
    return this.db.prepare("SELECT * FROM uploads WHERE owner = ? ORDER BY created_at DESC LIMIT 100").all(owner) as Upload[];
  }
  create(owner: string, raw: Record<string, unknown>) {
    const { name, size, fingerprint, preset } = raw;
    if (typeof name !== "string" || !name.trim() || name.length > 200 || /[\\/\x00-\x1f\x7f]/.test(name)) throw new PortalError(400, "Tên file không hợp lệ.");
    const extension = path.extname(name).toLowerCase();
    if (![".mp4", ".mov", ".mkv", ".webm", ".avi", ".mxf"].includes(extension)) throw new PortalError(400, "Chỉ nhận MP4, MOV, MKV, WEBM, AVI hoặc MXF.");
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 16 || size > this.config.maxFileBytes) throw new PortalError(413, "Dung lượng file vượt giới hạn.");
    if (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new PortalError(400, "Thiếu mã nhận dạng file.");
    if (typeof preset !== "string" || !Object.hasOwn(PRESETS, preset)) throw new PortalError(400, "Preset không hợp lệ.");
    return this.db.transaction(() => {
      // Also handles a lost create response. Does not reuse already-queued jobs.
      const previous = this.db.prepare("SELECT * FROM uploads WHERE owner = ? AND name = ? AND size = ? AND fingerprint = ? AND preset = ? AND state != 'submitted'")
        .get(owner, name, size, fingerprint, preset) as Upload | undefined;
      if (previous) return previous;
      const active = this.db.prepare("SELECT count(*) AS n FROM uploads WHERE state != 'submitted'").get() as { n: number };
      const records = this.db.prepare("SELECT count(*) AS n FROM uploads").get() as { n: number };
      if (records.n >= 100) throw new PortalError(429, "Đã đạt 100 file lưu trữ. Hãy tải kết quả và xóa phiên cũ.");
      if (active.n >= this.config.maxActive) throw new PortalError(429, "Đã đạt giới hạn phiên upload đang mở. Hãy hoàn tất hoặc xóa phiên cũ.");
      const quota = this.db.prepare("SELECT COALESCE(SUM(size * 3), 0) AS n FROM uploads").get() as { n: number };
      if (quota.n + size * 3 > this.config.quotaBytes) throw new PortalError(507, "Kho upload đã đạt hạn mức. Hãy tải kết quả và xóa phiên cũ.");
      const id = randomUUID(), now = Date.now();
      this.db.prepare("INSERT INTO uploads (id, owner, name, size, extension, fingerprint, preset, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, owner, name, size, extension, fingerprint, preset, now, now);
      return this.get(owner, id);
    })();
  }
  folder(upload: Upload) {
    const folder = path.resolve(this.config.root, upload.id);
    if (path.dirname(folder) !== path.resolve(this.config.root)) throw new PortalError(400, "Invalid upload path");
    return folder;
  }
  source(upload: Upload) { return path.join(this.folder(upload), `source${upload.extension}`); }
  input(upload: Upload) {
    return { ...PRESETS[upload.preset as keyof typeof PRESETS], projectId: `upload-${upload.id}`,
      sourcePath: `${this.config.workerRoot}\\${upload.id}\\source${upload.extension}`,
      outputPath: `${this.config.workerRoot}\\${upload.id}\\output.mp4` };
  }
  progress(upload: Upload, offset: number) {
    this.db.prepare("UPDATE uploads SET offset = ?, updated_at = ? WHERE id = ?").run(offset, Date.now(), upload.id);
  }
  state(upload: Upload, state: Upload["state"], jobId: number | null = upload.job_id) {
    this.db.prepare("UPDATE uploads SET state = ?, job_id = ?, updated_at = ? WHERE id = ?").run(state, jobId, Date.now(), upload.id);
  }
  allowLogin(key: string) {
    const now = Date.now();
    this.db.prepare("DELETE FROM auth_limits WHERE expires < ?").run(now);
    const row = this.db.prepare("SELECT count FROM auth_limits WHERE key = ?").get(key) as { count: number } | undefined;
    if (row && row.count >= 10) return false;
    this.db.prepare("INSERT INTO auth_limits VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1").run(key, now + 15 * 60_000);
    return true;
  }
}
