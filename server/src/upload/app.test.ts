import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm, mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import http from "node:http";
import { setTimeout as pause } from "node:timers/promises";
import { createUploadApp } from "./app.js";
import type { UploadConfig } from "./config.js";
import type { Upload } from "./store.js";
import type { Job } from "../job/types.js";
import type { Engine } from "./engine.js";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
test("portal: authenticated streaming, resume, checksum, idempotent jobs, private output, cleanup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dreamers-upload-"));
  const config: UploadConfig = { origin: "http://127.0.0.1:8090", root: path.join(root, "files"), database: path.join(root, "upload.sqlite"),
    workerRoot: "\\\\nas\\Projects\\SOURCE\\portal", engineUrl: "http://127.0.0.1:8080", engineUsername: "test", enginePassword: "fixture-only",
    username: "upload-test", password: "local-test-password-only", port: 8090, chunkBytes: 1024, maxFileBytes: 10240, quotaBytes: 102400,
    reserveBytes: 1, maxActive: 4, maxTransfers: 1, ttlMs: 3600_000, staticRoot: path.join(root, "public") };
  const engineJobs = new Map<string, Job>(); let requests = 0, loseResponse = true;
  const engine: Engine = {
    create: async (key, input) => {
      requests++;
      assert.match(String(input.sourcePath), /^\\\\nas\\Projects\\SOURCE\\portal\\[0-9a-f-]+\\source.mp4$/);
      assert.equal(input.codec, "h264_nvenc");
      if (!engineJobs.has(key)) engineJobs.set(key, { id: 70, status: "QUEUED", progress: 0, input: JSON.stringify(input) } as Job);
      if (loseResponse) { loseResponse = false; throw new Error("Response lost after engine commit"); }
      return engineJobs.get(key)!;
    },
    get: async () => [...engineJobs.values()][0]!,
    cancel: async () => { const job = [...engineJobs.values()][0]!; job.status = "CANCELLED"; return job; },
  };
  let service = await createUploadApp(config, engine);
  let server = service.app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  let base = `http://127.0.0.1:${(server.address() as { port: number }).port}/upload/api`;
  let cookie = "", csrf = "";
  const request = (route: string, method = "GET", body?: unknown, headers?: Record<string, string>) => fetch(base + route, { method,
    headers: { Origin: config.origin, Cookie: cookie, "X-CSRF-Token": csrf, "Content-Type": "application/json", ...headers },
    ...(body !== undefined ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {}),
  });
  const close = async () => { await new Promise<void>(resolve => server.close(() => resolve())); service.store.db.close(); };
  try {
    assert.equal((await request("/uploads")).status, 401);
    assert.equal((await request("/login", "POST", { username: config.username, password: config.password }, { Origin: "https://attacker.example" })).status, 403);
    assert.equal((await request("/login", "POST", { username: config.username, password: "wrong" })).status, 401);
    const login = await request("/login", "POST", { username: config.username, password: config.password });
    assert.equal(login.status, 200); cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    assert.match(login.headers.get("set-cookie")!, /HttpOnly/); assert.match(login.headers.get("set-cookie")!, /SameSite=Strict/);
    csrf = (await login.json() as { csrf: string }).csrf;
    assert.equal((await request("/uploads", "POST", {}, { "X-CSRF-Token": "wrong" })).status, 403);
    const data = Buffer.alloc(2400, 42); data.write("ftyp", 4);
    const metadata = { name: "video.mp4", size: data.length, fingerprint: sha(data), preset: "review" };
    assert.equal((await request("/uploads", "POST", { ...metadata, name: "../../bad.mp4" })).status, 400);
    assert.equal((await request("/uploads", "POST", { ...metadata, size: 99999 })).status, 413);
    assert.equal((await request("/uploads", "POST", { ...metadata, name: "code.php" })).status, 400);
    const created = await request("/uploads", "POST", metadata); assert.equal(created.status, 201);
    const upload = await created.json() as Upload;
    const duplicate = await (await request("/uploads", "POST", metadata)).json() as Upload;
    assert.equal(duplicate.id, upload.id);
    service.store.create("another-owner", { ...metadata, name: "private.mp4" });
    const other = service.store.list("another-owner")[0]!;
    assert.equal((await request(`/uploads/${other.id}`)).status, 404);
    assert.equal((await request(`/uploads/${other.id}/chunk`, "PUT", data.subarray(0, 1024), { "Content-Type": "application/octet-stream" })).status, 404);
    const put = (offset: number, buffer: Buffer, checksum = sha(buffer)) => request(`/uploads/${upload.id}/chunk`, "PUT", buffer,
      { "Content-Type": "application/octet-stream", "Upload-Offset": String(offset), "Upload-Checksum": checksum });
    assert.equal((await request(`/uploads/${upload.id}/complete`, "POST", {})).status, 409);
    assert.equal((await put(0, data.subarray(0, 1024), "a".repeat(64))).status, 422);
    assert.equal((await stat(path.join(config.root, upload.id, "source.part"))).size, 0);
    assert.equal((await put(0, data.subarray(0, 1024))).status, 200);
    assert.equal((await put(0, data.subarray(0, 1024))).status, 409, "lost ACK retries do not append twice");
    const second = await (await request("/uploads", "POST", { ...metadata, name: "second.mp4" })).json() as Upload;
    // Hold a partially transmitted chunk: same file is locked, other files respect the global cap.
    const held = http.request(`${base}/uploads/${upload.id}/chunk`, { method: "PUT", headers: {
      Origin: config.origin, Cookie: cookie, "X-CSRF-Token": csrf, "Content-Type": "application/octet-stream",
      "Content-Length": "1024", "Upload-Offset": "1024", "Upload-Checksum": sha(data.subarray(1024, 2048)),
    } });
    held.on("error", () => {}); held.write(data.subarray(1024, 1124));
    try {
      for (let i = 0; i < 100 && (await stat(path.join(config.root, upload.id, "source.part"))).size === 1024; i++) await pause(10);
      assert.equal((await stat(path.join(config.root, upload.id, "source.part"))).size, 1124);
      assert.equal((await put(1024, data.subarray(1024, 2048))).status, 409);
      assert.equal((await request(`/uploads/${second.id}/chunk`, "PUT", data.subarray(0, 1024), {
        "Content-Type": "application/octet-stream", "Upload-Offset": "0", "Upload-Checksum": sha(data.subarray(0, 1024)),
      })).status, 429);
    } finally { held.destroy(); }
    for (let i = 0; i < 100 && (await stat(path.join(config.root, upload.id, "source.part"))).size !== 1024; i++) await pause(10);
    assert.equal((await stat(path.join(config.root, upload.id, "source.part"))).size, 1024, "disconnect rolls back the incomplete chunk");
    assert.equal(service.store.get(config.username, upload.id).offset, 1024);
    // Simulate a crash after filesystem write but before database commit.
    await writeFile(path.join(config.root, upload.id, "source.part"), Buffer.concat([data.subarray(0, 1024), Buffer.from("uncommitted tail")]));
    await close();
    service = await createUploadApp(config, engine); server = service.app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}/upload/api`;
    assert.equal((await request("/me")).status, 200, "session persists across restart");
    assert.equal((await (await request(`/uploads/${upload.id}`)).json() as Upload).offset, 1024);
    assert.equal((await put(1024, data.subarray(1024, 2048))).status, 200);
    assert.equal((await put(2048, data.subarray(2048))).status, 200);
    assert.equal((await request(`/uploads/${upload.id}/complete`, "POST", {})).status, 200);
    assert.equal(service.store.get(config.username, upload.id).state, "submitting");
    await service.maintenance();
    assert.equal(service.store.get(config.username, upload.id).state, "submitted");
    assert.equal(engineJobs.size, 1); assert.equal(requests, 2);
    assert.deepEqual(await readFile(path.join(config.root, upload.id, "source.mp4")), data);
    await request(`/uploads/${upload.id}/complete`, "POST", {}); assert.equal(requests, 2);
    assert.equal((await request(`/uploads/${upload.id}`, "DELETE")).status, 409);
    assert.equal((await request(`/uploads/${upload.id}/output`)).status, 409);
    const job = [...engineJobs.values()][0]!; job.status = "COMPLETED"; job.progress = 100;
    await writeFile(path.join(config.root, upload.id, "output.mp4"), data);
    const output = await request(`/uploads/${upload.id}/output`); assert.equal(output.status, 200); assert.match(output.headers.get("content-disposition")!, /^attachment;/);
    assert.deepEqual(Buffer.from(await output.arrayBuffer()), data);
    const partial = await request(`/uploads/${upload.id}/output`, "GET", undefined, { Range: "bytes=0-15" }); assert.equal(partial.status, 206);
    assert.equal((await partial.arrayBuffer()).byteLength, 16);
    const publicJob = await (await request(`/uploads/${upload.id}/job`)).json(); assert.ok(!JSON.stringify(publicJob).includes("nas"));
    const publicUpload = await (await request(`/uploads/${upload.id}`)).json(); assert.ok(!JSON.stringify(publicUpload).includes("sourcePath"));
    const missing = await fetch(base.replace("/upload/api", "/api/workstations")); assert.equal(missing.status, 404);
    assert.equal((await request(`/uploads/${upload.id}`, "DELETE")).status, 200);
    await assert.rejects(stat(path.join(config.root, upload.id)));
    // Expiry only removes abandoned input, never submitted files or unrelated studio data.
    service.store.db.prepare("UPDATE uploads SET updated_at = 0 WHERE id = ?").run(other.id);
    await mkdir(path.join(config.root, "studio-data"));
    await writeFile(path.join(config.root, "studio-data", "keep.txt"), "keep");
    await service.maintenance(); assert.equal(await readFile(path.join(config.root, "studio-data", "keep.txt"), "utf8"), "keep");
    assert.equal((await request("/logout", "POST", {})).status, 200);
    assert.equal((await request("/uploads")).status, 401);
  } finally { await close(); await rm(root, { recursive: true, force: true }); }
});

test("store enforces global quota, allowed presets, and login retry budget", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dreamers-upload-limits-"));
  const config = { root, database: path.join(root, "db.sqlite"), staticRoot: path.join(root, "public"), username: "test", password: "test-password", origin: "https://vncgi.online", quotaBytes: 900, maxFileBytes: 1000, maxActive: 1 } as UploadConfig;
  const service = await createUploadApp(config, {} as Engine);
  try {
    const input = { name: "a.mp4", size: 400, fingerprint: "a".repeat(64), preset: "review" };
    assert.throws(() => service.store.create("test", input), /hạn mức/);
    assert.throws(() => service.store.create("test", { ...input, preset: "custom command" }), /Preset/);
    service.store.create("test", { ...input, size: 200 });
    assert.throws(() => service.store.create("test", { ...input, size: 200, name: "b.mp4" }), /giới hạn/);
    for (let i = 0; i < 10; i++) assert.equal(service.store.allowLogin("budget"), true);
    assert.equal(service.store.allowLogin("budget"), false);
  } finally { service.store.db.close(); await rm(root, { recursive: true, force: true }); }
});
