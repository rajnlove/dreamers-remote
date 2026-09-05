import http from "node:http";
import { uploadConfig } from "./config.js";
import { EngineClient } from "./engine.js";
import { createUploadApp } from "./app.js";

// Dataset group/ACL is shared with the Windows worker's SMB identity.
process.umask(0o007);
const config = uploadConfig();
const { app, maintenance } = await createUploadApp(config, new EngineClient(config));
const server = http.createServer({ maxHeaderSize: 16 * 1024 }, app);
server.requestTimeout = 120_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxConnections = 40;
const timer = setInterval(() => { void maintenance().catch(() => console.error("Upload maintenance failed")); }, 30_000);
timer.unref();
server.listen(config.port, "0.0.0.0", () => console.log(`Upload portal listening on :${config.port}/upload/`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
  clearInterval(timer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 95_000).unref();
});
