import { open, mkdir, lstat, realpath, statfs, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Request } from "express";
import { PortalError, UploadStore, type Upload } from "./store.js";

// Storage is a private NAS dataset, never a web-served directory.
export async function safeFolder(store: UploadStore, upload: Upload) {
  const folder = store.folder(upload);
  await mkdir(folder, { recursive: true, mode: 0o770 });
  if ((await lstat(folder)).isSymbolicLink() || await realpath(folder) !== path.join(await realpath(store.config.root), upload.id)) {
    throw new PortalError(400, "Thư mục upload không hợp lệ.");
  }
  return folder;
}
export async function freeSpace(store: UploadStore, incoming: number) {
  const info = await statfs(store.config.root);
  if (info.bavail * info.bsize < incoming + store.config.reserveBytes) throw new PortalError(507, "Ổ lưu trữ không đủ dung lượng trống an toàn.");
}
export async function receiveChunk(store: UploadStore, upload: Upload, request: Request) {
  if (upload.state !== "uploading") throw new PortalError(409, "File đã hoàn tất upload.");
  const offsetText = request.get("Upload-Offset") ?? "";
  if (!/^\d+$/.test(offsetText) || Number(offsetText) !== upload.offset) throw new PortalError(409, "Vị trí upload đã thay đổi. Đồng bộ lại để tiếp tục.");
  const expected = Math.min(upload.chunk_bytes, upload.size - upload.offset);
  const length = request.get("Content-Length");
  if (!expected || !length || !/^\d+$/.test(length) || Number(length) !== expected) throw new PortalError(400, "Kích thước phần upload không đúng.");
  if (request.get("Content-Type") !== "application/octet-stream" || request.get("Content-Encoding")) throw new PortalError(415, "Định dạng phần upload không hợp lệ.");
  const digest = request.get("Upload-Checksum");
  if (!digest || !/^[a-f0-9]{64}$/.test(digest)) throw new PortalError(400, "Thiếu checksum phần upload.");
  await freeSpace(store, expected);
  const folder = await safeFolder(store, upload);
  const file = path.join(folder, "source.part");
  const existing = await lstat(file).catch(() => null);
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new PortalError(400, "File lưu trữ không hợp lệ.");
  if ((!existing && upload.offset > 0) || (existing && existing.size < upload.offset)) throw new PortalError(409, "File lưu trữ bị thiếu. Hãy xóa phiên và upload lại.");
  const handle = await open(file, existing ? "r+" : "wx", 0o660);
  let received = 0;
  const hash = createHash("sha256");
  const timer = setTimeout(() => request.destroy(new Error("Chunk timeout")), 90_000);
  try {
    // Recover from a process crash after writing bytes but before committing offset.
    await handle.truncate(upload.offset);
    for await (const raw of request) {
      const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as string);
      if (received + buffer.length > expected) throw new PortalError(413, "Phần upload quá lớn.");
      hash.update(buffer);
      let written = 0;
      while (written < buffer.length) {
        const result = await handle.write(buffer, written, buffer.length - written, upload.offset + received + written);
        if (!result.bytesWritten) throw new Error("Unable to write upload");
        written += result.bytesWritten;
      }
      received += buffer.length;
    }
    if (received !== expected || hash.digest("hex") !== digest) throw new PortalError(422, "Phần upload bị thiếu hoặc sai checksum. Hãy gửi lại.");
    await handle.sync();
    store.progress(upload, upload.offset + received);
  } catch (error) {
    await handle.truncate(upload.offset);
    throw error;
  } finally { clearTimeout(timer); await handle.close(); }
}
export async function completeFile(store: UploadStore, upload: Upload) {
  if (upload.offset !== upload.size) throw new PortalError(409, "File chưa upload đủ.");
  const folder = await safeFolder(store, upload);
  const final = store.source(upload), partial = path.join(folder, "source.part");
  // A completed rename followed by a crash is safe to repeat.
  const finalStat = await lstat(final).catch(() => null);
  const file = finalStat ? final : partial;
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== upload.size) throw new PortalError(422, "File không khớp kích thước đã đăng ký.");
  const handle = await open(file, "r");
  try {
    const header = Buffer.alloc(32); await handle.read(header, 0, header.length, 0);
    const ext = upload.extension;
    const valid = ([".mp4", ".mov"].includes(ext) && ["ftyp", "moov", "mdat", "wide", "free"].includes(header.toString("ascii", 4, 8))) ||
      ([".mkv", ".webm"].includes(ext) && header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) ||
      (ext === ".avi" && header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "AVI ") ||
      (ext === ".mxf" && header.subarray(0, 4).equals(Buffer.from([0x06, 0x0e, 0x2b, 0x34])));
    if (!valid) throw new PortalError(415, "Nội dung file không khớp định dạng video được hỗ trợ.");
  } finally { await handle.close(); }
  if (!finalStat) await rename(partial, final);
  store.state(upload, "ready");
}
export async function removeUploadFiles(store: UploadStore, upload: Upload) {
  const folder = store.folder(upload);
  // Generated UUID child only; never user-provided paths or other studio data.
  const info = await lstat(folder).catch(() => null);
  if (info) { await safeFolder(store, upload); await rm(folder, { recursive: true, force: true }); }
  store.db.prepare("DELETE FROM uploads WHERE id = ?").run(upload.id);
}
