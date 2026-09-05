import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import type { Request } from "express";
import { UploadStore } from "./store.js";
import { receiveChunk } from "./files.js";
import type { UploadConfig } from "./config.js";

test("legacy migration, old tabs and 32 MiB streaming retain independent chunk sizes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "upload-chunks-"));
  const mib = 1024 ** 2;
  const config = { root, database: path.join(root, "db.sqlite"), chunkBytes: 32 * mib,
    maxFileBytes: 100 * mib, quotaBytes: 1024 * mib, maxActive: 10, reserveBytes: 1 } as UploadConfig;
  let store = new UploadStore(config);
  const metadata = { name: "legacy.mp4", size: 32 * mib + 123, fingerprint: "a".repeat(64), preset: "review" };
  try {
    const legacy = store.create("owner", metadata);
    assert.equal(legacy.chunk_bytes, 4 * mib, "old open tab without chunkBytes remains compatible");
    store.db.exec("ALTER TABLE uploads DROP COLUMN chunk_bytes");
    store.db.close(); store = new UploadStore(config);
    assert.equal(store.get("owner", legacy.id).chunk_bytes, 4 * mib, "old database migrates to 4 MiB");
    for (const chunkBytes of [0, -1, "33554432", 33 * mib, 4 * mib + 0.5]) {
      assert.throws(() => store.create("owner", { ...metadata, chunkBytes }), /Kích thước/);
    }
    const upload = store.create("owner", { ...metadata, name: "large.mp4", chunkBytes: 32 * mib });
    assert.equal(upload.chunk_bytes, 32 * mib);
    assert.throws(() => store.create("owner", { ...metadata, name: "large.mp4" }), /khớp/);
    const data = Buffer.alloc(metadata.size, 42);
    const send = async (offset: number, bytes: Buffer, bad = false) => {
      const headers: Record<string, string> = { "Upload-Offset": String(offset), "Content-Length": String(bytes.length),
        "Content-Type": "application/octet-stream", "Upload-Checksum": bad ? "0".repeat(64) : createHash("sha256").update(bytes).digest("hex") };
      const request = Readable.from((function* () { for (let n = 0; n < bytes.length; n += 65536) yield bytes.subarray(n, n + 65536); })());
      Object.assign(request, { get: (name: string) => headers[name] });
      await receiveChunk(store, store.get("owner", upload.id), request as unknown as Request);
    };
    await assert.rejects(send(0, data.subarray(0, 32 * mib), true), /checksum/);
    assert.equal((await stat(path.join(root, upload.id, "source.part"))).size, 0);
    await send(0, data.subarray(0, 32 * mib));
    store.db.close(); store = new UploadStore({ ...config, chunkBytes: 4 * mib });
    assert.equal(store.get("owner", upload.id).offset, 32 * mib);
    await send(32 * mib, data.subarray(32 * mib));
    assert.deepEqual(await readFile(path.join(root, upload.id, "source.part")), data);
  } finally { store.db.close(); await rm(root, { recursive: true, force: true }); }
});
