import express, { type Request, type Response, type NextFunction } from "express";
import { randomBytes, createHash } from "node:crypto";
import { lstat, realpath, readdir } from "node:fs/promises";
import path from "node:path";
import type { UploadConfig } from "./config.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { UploadStore, PortalError, type Upload } from "./store.js";
import { completeFile, freeSpace, receiveChunk, removeUploadFiles, safeFolder } from "./files.js";
import { EngineResponseError, type Engine } from "./engine.js";
import type { Job } from "../job/types.js";

const API = "/upload/api";
const cookieName = "dreamers.upload";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const asyncRoute = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(next); };
type Session = { owner: string; csrf: string };
const view = (u: Upload) => ({ id: u.id, name: u.name, size: u.size, offset: u.offset, chunkBytes: u.chunk_bytes, fingerprint: u.fingerprint, preset: u.preset, state: u.state, jobId: u.job_id, createdAt: u.created_at, updatedAt: u.updated_at });

export async function createUploadApp(config: UploadConfig, engine: Engine) {
  const store = new UploadStore(config);
  // Password rotation revokes old cookies, while ordinary restarts preserve sessions.
  store.db.exec("CREATE TABLE IF NOT EXISTS auth_config (id INTEGER PRIMARY KEY, verifier TEXT NOT NULL)");
  const authConfig = store.db.prepare("SELECT verifier FROM auth_config WHERE id = 1").get() as { verifier: string } | undefined;
  if (!authConfig || !await verifyPassword(`${config.username}\n${config.password}`, authConfig.verifier)) {
    const verifier = await hashPassword(`${config.username}\n${config.password}`);
    store.db.transaction(() => {
      store.db.prepare("DELETE FROM sessions").run();
      store.db.prepare("INSERT OR REPLACE INTO auth_config VALUES (1, ?)").run(verifier);
    })();
  }
  const passwordHash = await hashPassword(config.password);
  const app = express();
  let requestWindow = Date.now(), requests = 0;
  app.disable("x-powered-by");
  // Explicit origin, no reflected CORS, no trust of forwarded IP/host headers.
  app.use((_req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'" });
    next();
  });
  app.use(API, (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (Date.now() - requestWindow > 60_000) { requestWindow = Date.now(); requests = 0; }
    if (++requests > 1200) { res.set("Retry-After", "60"); res.status(429).json({ error: "Cổng đang bận. Vui lòng thử lại sau một phút." }); return; }
    const origin = req.get("Origin");
    if ((origin && origin !== config.origin) || (!["GET", "HEAD"].includes(req.method) && origin !== config.origin)) {
      res.status(403).json({ error: "Nguồn truy cập không được phép." }); return;
    }
    if (req.get("Sec-Fetch-Site") === "cross-site") { res.status(403).json({ error: "Không cho phép truy cập chéo trang." }); return; }
    next();
  });
  app.use(API, express.json({ limit: "8kb" }));
  const sessions = (req: Request): Session | undefined => {
    const token = (req.get("Cookie") ?? "").split(";").map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return undefined;
    return store.db.prepare("SELECT owner, csrf FROM sessions WHERE hash = ? AND expires > ?").get(hash(token), Date.now()) as Session | undefined;
  };
  let loginBusy = false;
  app.post(`${API}/login`, asyncRoute(async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body.username !== "string" || typeof body.password !== "string" || body.username.length > 100 || body.password.length > 256) throw new PortalError(400, "Thông tin đăng nhập không hợp lệ.");
    // Fixed account/global budget survives restarts; never key by an attacker-supplied username/IP.
    if (loginBusy || !store.allowLogin("portal-login")) { res.set("Retry-After", "900"); throw new PortalError(429, "Quá nhiều lần đăng nhập. Vui lòng thử lại sau 15 phút."); }
    loginBusy = true;
    let valid = false;
    try { valid = await verifyPassword(body.password, passwordHash); } finally { loginBusy = false; }
    if (!valid || body.username !== config.username) throw new PortalError(401, "Tài khoản hoặc mật khẩu không đúng.");
    store.db.prepare("DELETE FROM auth_limits WHERE key = 'portal-login'").run();
    const token = randomBytes(32).toString("hex"), csrf = randomBytes(32).toString("hex"), now = Date.now();
    store.db.prepare("DELETE FROM sessions WHERE expires < ?").run(now);
    // Bound concurrent sessions for this account without exposing them to clients.
    store.db.prepare("DELETE FROM sessions WHERE hash IN (SELECT hash FROM sessions WHERE owner = ? ORDER BY expires DESC LIMIT -1 OFFSET 19)").run(config.username);
    store.db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)").run(hash(token), config.username, csrf, now + 24 * 3600_000);
    res.cookie(cookieName, token, { httpOnly: true, secure: config.origin.startsWith("https:"), sameSite: "strict", path: "/upload", maxAge: 24 * 3600_000 });
    res.json({ username: config.username, csrf });
  }));
  app.use(API, (req, res, next) => {
    const session = sessions(req);
    if (!session || session.owner !== config.username) { res.status(401).json({ error: "Vui lòng đăng nhập." }); return; }
    res.locals.portalSession = session;
    if (!["GET", "HEAD"].includes(req.method) && req.get("X-CSRF-Token") !== session.csrf) {
      res.status(403).json({ error: "Phiên xác thực không hợp lệ. Hãy tải lại trang." }); return;
    }
    next();
  });
  app.get(`${API}/me`, (_req, res) => {
    const session = res.locals.portalSession as Session;
    res.json({ username: session.owner, csrf: session.csrf, chunkBytes: config.chunkBytes, maxFileBytes: config.maxFileBytes,
      quotaBytes: config.quotaBytes, incompleteTtlHours: config.ttlMs / 3600_000 });
  });
  app.post(`${API}/logout`, (req, res) => {
    const session = res.locals.portalSession as Session;
    store.db.prepare("DELETE FROM sessions WHERE owner = ? AND csrf = ?").run(session.owner, session.csrf);
    res.clearCookie(cookieName, { path: "/upload", secure: config.origin.startsWith("https:"), httpOnly: true, sameSite: "strict" });
    res.json({ ok: true });
  });
  const owner = (res: Response) => (res.locals.portalSession as Session).owner;
  const locked = new Set<string>();
  const downloads = new Map<string, number>();
  const exclusive = async <T>(id: string, fn: () => Promise<T>) => {
    if (locked.has(id)) throw new PortalError(409, "Phiên đang xử lý một yêu cầu khác. Vui lòng thử lại.");
    locked.add(id);
    try { return await fn(); } finally { locked.delete(id); }
  };
  let transfers = 0;
  const transfer = async <T>(fn: () => Promise<T>) => {
    if (transfers >= config.maxTransfers) throw new PortalError(429, "Cổng đang nhận đủ số luồng cho phép. Sẽ thử lại.");
    transfers++;
    try { return await fn(); } finally { transfers--; }
  };
  app.get(`${API}/uploads`, (_req, res) => res.json(store.list(owner(res)).map(view)));
  const cleanupAccess = async (upload: Upload, claim = false) => {
    if (["ready", "submitting"].includes(upload.state)) throw new PortalError(409, "Đang xác nhận job; chưa thể xóa file.");
    if (downloads.has(upload.id)) throw new PortalError(409, "File đang được tải xuống. Vui lòng chờ tải xong.");
    if (!upload.job_id) return "Chưa gửi encode";
    if (engine.cleanup) {
      const result = await engine.cleanup(upload.job_id, `upload-${upload.id}`, claim).catch(error => {
        if (error instanceof EngineResponseError && error.status === 404) throw new PortalError(409, "Job cũ thiếu lịch sử xác nhận dừng. Quản trị viên cần kiểm tra một lần.");
        if (error instanceof EngineResponseError && error.status === 409) throw new PortalError(409, "Trạng thái job vừa thay đổi; chưa thể dọn file.");
        throw error;
      });
      if (!result.allowed) throw new PortalError(409, "Job đang chờ, đang chạy hoặc chưa xác nhận dừng; chưa thể dọn file.");
      return result.archived ? "Job đã dọn khỏi lịch sử" : result.status === "COMPLETED" ? "Hoàn tất" : "Thất bại";
    }
    const job = await engine.get(upload.job_id);
    if (!["COMPLETED", "FAILED"].includes(job.status)) throw new PortalError(409, "Job chưa kết thúc; chưa thể xóa file.");
    return job.status === "COMPLETED" ? "Hoàn tất" : "Thất bại";
  };
  const storedBytes = async (upload: Upload) => {
    const folder = store.folder(upload);
    const info = await lstat(folder).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
    if (!info) return 0;
    await safeFolder(store, upload);
    let bytes = 0;
    for (const name of await readdir(folder)) {
      const file = await lstat(path.join(folder, name));
      if (!file.isFile() || file.isSymbolicLink()) throw new PortalError(409, "Kho chứa mục bất thường; chưa thể tự động dọn.");
      bytes += file.size;
    }
    return bytes;
  };
  app.get(`${API}/cleanup`, asyncRoute(async (_req, res) => {
    const items = [];
    let unavailable = false;
    for (const upload of store.list(owner(res))) {
      let bytes = 0, allowed = false, reason = "";
      try {
        if (locked.has(upload.id)) throw new PortalError(409, "File đang được truyền hoặc xử lý.");
        bytes = await storedBytes(upload);
        if (unavailable && upload.job_id) throw new PortalError(503, "Hàng đợi chưa kết nối. Vui lòng thử lại sau.");
        reason = await cleanupAccess(upload); allowed = true;
      } catch (error) { if (!(error instanceof PortalError)) unavailable = true; reason = error instanceof PortalError ? error.message : "Chưa xác minh được trạng thái job. Thử làm mới sau."; }
      items.push({ id: upload.id, name: upload.name, bytes, allowed, reason });
    }
    res.json(items);
  }));
  const deleteUpload = async (upload: Upload) => exclusive(upload.id, async () => {
    // The engine claim atomically prevents a FAILED job from being retried during deletion.
    const bytes = await storedBytes(upload);
    await cleanupAccess(upload, true);
    await removeUploadFiles(store, upload);
    return bytes;
  });
  app.post(`${API}/cleanup`, asyncRoute(async (req, res) => {
    const ids: unknown = req.body?.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) throw new PortalError(400, "Chọn từ 1 đến 100 file khác nhau.");
    // Resolve every record through the owner gate before deleting anything in the batch.
    const uploads = ids.map(id => store.get(owner(res), id));
    const results = [];
    for (const upload of uploads) {
      try { results.push({ id: upload.id, deleted: true, bytes: await deleteUpload(upload) }); }
      catch (error) { results.push({ id: upload.id, deleted: false, bytes: 0, reason: error instanceof PortalError ? error.message : "Chưa thể xác minh hoặc xóa file. Vui lòng thử lại." }); }
    }
    res.json({ results });
  }));
  app.post(`${API}/uploads`, asyncRoute(async (req, res) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw new PortalError(400, "Yêu cầu không hợp lệ.");
    if (typeof req.body.size === "number" && Number.isSafeInteger(req.body.size) && req.body.size > 0) await freeSpace(store, req.body.size * 3);
    const upload = store.create(owner(res), req.body as Record<string, unknown>);
    await safeFolder(store, upload);
    res.status(201).json(view(upload));
  }));
  app.get(`${API}/uploads/:id`, (req, res, next) => {
    try { res.json(view(store.get(owner(res), req.params.id!))); } catch (error) { next(error); }
  });
  app.put(`${API}/uploads/:id/chunk`, asyncRoute(async (req, res) => {
    const upload = store.get(owner(res), req.params.id!);
    await exclusive(upload.id, () => transfer(async () => {
      await receiveChunk(store, upload, req);
      res.json(view(store.get(owner(res), upload.id)));
    }));
  }));
  const submit = async (upload: Upload) => {
    if (upload.job_id) return;
    store.state(upload, "submitting");
    // State persists before the HTTP request. The Job Engine persists the same key atomically.
    // Provenance is built only from stored upload fields so a retried
    // submission reproduces it exactly (see EngineClient.create). The
    // portal has no project/shot/version of its own, so it sends what it
    // actually knows -- who uploaded, when, and the upload's own name --
    // rather than inventing identifiers.
    const job = await engine.create(`upload-${upload.id}`, store.input(upload), {
      job_name: upload.name,
      uploaded_by_name: upload.owner,
      uploaded_at: new Date(upload.created_at).toISOString(),
    });
    store.state(upload, "submitted", job.id);
  };
  app.post(`${API}/uploads/:id/complete`, asyncRoute(async (req, res) => {
    const upload = store.get(owner(res), req.params.id!);
    await exclusive(upload.id, async () => {
      if (upload.state === "uploading") await completeFile(store, upload);
      try { await submit(store.get(owner(res), upload.id)); } catch { /* Durable retry by maintenance; client sees submitting. */ }
      res.json(view(store.get(owner(res), upload.id)));
    });
  }));
  const cache = new Map<number, { until: number; promise: Promise<Job> }>();
  const getJob = (id: number) => {
    const previous = cache.get(id);
    if (previous && previous.until > Date.now()) return previous.promise;
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    const promise = engine.get(id).catch(error => { cache.delete(id); throw error; });
    cache.set(id, { until: Date.now() + 5000, promise });
    return promise;
  };
  const uploadJob = (upload: Upload) => getJob(upload.job_id!).catch(async error => {
      if (!engine.cleanup) throw error;
      const archived = await engine.cleanup(upload.job_id!, `upload-${upload.id}`, false);
      if (!archived.archived) throw error;
      return { id: archived.id, status: archived.status, progress: archived.status === "COMPLETED" ? 100 : 0, fps: null, eta_seconds: null };
    });
  app.get(`${API}/uploads/:id/job`, asyncRoute(async (req, res) => {
    const upload = store.get(owner(res), req.params.id!);
    if (!upload.job_id) { res.json(null); return; }
    const job = await uploadJob(upload);
    // No studio paths, other users' jobs, process arguments, or raw worker errors in public responses.
    res.json({ id: job.id, status: job.status, progress: job.progress, fps: job.fps, etaSeconds: job.eta_seconds,
      error: job.status === "FAILED" ? "Xử lý thất bại. Quản trị viên có thể xem chi tiết trong Render Queue." : null });
  }));
  app.post(`${API}/uploads/:id/cancel`, asyncRoute(async (req, res) => {
    const upload = store.get(owner(res), req.params.id!);
    await exclusive(upload.id, async () => {
      if (!upload.job_id) throw new PortalError(409, "Job chưa được xác nhận. Hãy chờ đồng bộ.");
      await engine.cancel(upload.job_id); cache.delete(upload.job_id);
      res.json({ ok: true });
    });
  }));
  app.delete(`${API}/uploads/:id`, asyncRoute(async (req, res) => {
    const upload = store.get(owner(res), req.params.id!);
    await deleteUpload(upload);
    res.json({ ok: true });
  }));
  app.get(`${API}/uploads/:id/output`, asyncRoute(async (req, res) => {
    const upload = store.get(owner(res), req.params.id!);
    if (locked.has(upload.id)) throw new PortalError(409, "File đang được xử lý hoặc dọn dẹp.");
    downloads.set(upload.id, (downloads.get(upload.id) ?? 0) + 1);
    let downloadReleased = false;
    const releaseDownload = () => {
      if (downloadReleased) return; downloadReleased = true;
      const count = (downloads.get(upload.id) ?? 1) - 1;
      if (count) downloads.set(upload.id, count); else downloads.delete(upload.id);
    };
    res.on("close", releaseDownload); res.on("finish", releaseDownload);
    if (!upload.job_id || (await uploadJob(upload)).status !== "COMPLETED") throw new PortalError(409, "Kết quả chưa sẵn sàng.");
    if (transfers >= config.maxTransfers) throw new PortalError(429, "Cổng đang bận. Vui lòng tải lại sau.");
    const folder = await safeFolder(store, upload), file = path.join(folder, "output.mp4");
    const info = await lstat(file).catch(() => null);
    if (!info || !info.isFile() || info.isSymbolicLink() || await realpath(file) !== path.join(await realpath(folder), "output.mp4")) throw new PortalError(404, "Không tìm thấy kết quả trên kho lưu trữ.");
    if (transfers >= config.maxTransfers) throw new PortalError(429, "Cổng đang bận. Vui lòng tải lại sau.");
    transfers++;
    let released = false;
    const release = () => { if (!released) { transfers--; released = true; } };
    res.on("close", release); res.on("finish", release);
    res.set("Content-Type", "application/octet-stream");
    res.download(file, `${path.parse(upload.name).name}-encoded.mp4`, error => { release(); if (error && !res.headersSent) res.status(500).end(); });
  }));
  app.use(API, (_req, res) => res.status(404).json({ error: "Không tìm thấy chức năng." }));
  app.use("/upload/assets", express.static(path.join(config.staticRoot, "assets"), { immutable: true, maxAge: "1y", dotfiles: "deny" }));
  app.get(["/upload", "/upload/"], (_req, res) => {
    res.set("Cache-Control", "no-store"); res.sendFile(path.join(config.staticRoot, "index.html"));
  });
  app.use((_req, res) => res.status(404).end());
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent || res.destroyed) return;
    if (error instanceof PortalError) { res.status(error.status).json({ error: error.message }); return; }
    const status = (error as { status?: number })?.status;
    if (status === 413 || status === 400) { res.status(status).json({ error: "Yêu cầu không hợp lệ hoặc quá lớn." }); return; }
    // Log only class/code, not raw secrets, paths, request data or service responses.
    console.error("Upload request failed", error instanceof Error ? error.name : "unknown");
    res.status(503).json({ error: "Dịch vụ tạm thời chưa sẵn sàng. File đã nhận vẫn được giữ; hãy thử lại." });
  });
  let maintaining = false;
  const maintenance = async () => {
    if (maintaining) return;
    maintaining = true;
    try {
      store.db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
      const pending = store.db.prepare("SELECT * FROM uploads WHERE state IN ('submitting','ready') ORDER BY updated_at LIMIT 1").all() as Upload[];
      for (const upload of pending) if (!locked.has(upload.id)) await exclusive(upload.id, () => submit(upload)).catch(() => {});
      const expired = store.db.prepare("SELECT * FROM uploads WHERE state = 'uploading' AND updated_at < ? LIMIT 2").all(Date.now() - config.ttlMs) as Upload[];
      for (const upload of expired) if (!locked.has(upload.id)) await exclusive(upload.id, () => removeUploadFiles(store, upload));
    } finally { maintaining = false; }
  };
  return { app, store, maintenance };
}
