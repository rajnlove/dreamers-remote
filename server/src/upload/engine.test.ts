import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { EngineClient } from "./engine.js";
import type { UploadConfig } from "./config.js";

test("portal engine uses its private session and requires updated input-safety workers", async () => {
  const app = express(); app.use(express.json());
  app.post("/api/auth/login", (req, res) => {
    assert.equal(req.body.username, "upload-portal");
    res.set("Set-Cookie", "connect.sid=fixture; HttpOnly").json({ ok: true });
  });
  app.post("/api/jobs", (req, res) => {
    assert.equal(req.get("Cookie"), "connect.sid=fixture");
    assert.equal(req.get("Idempotency-Key"), "upload-fixture-request");
    assert.deepEqual(req.body.required_software, { upload_input_safety: "1" });
    assert.equal(req.body.type, "ffmpeg");
    assert.equal(JSON.parse(req.body.input).codec, "h264_nvenc");
    res.json({ id: 42, status: "QUEUED" });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening", r));
  try {
    const engine = new EngineClient({ engineUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      engineUsername: "upload-portal", enginePassword: "fixture" } as UploadConfig);
    assert.equal((await engine.create("upload-fixture-request", { codec: "h264_nvenc" })).id, 42);
  } finally { await new Promise<void>(r => server.close(() => r())); }
});
