import express from "express";
import { env } from "./config/env.js";
import { workstationsRouter } from "./api/workstations.js";
import { ConflictError, NotFoundError, ValidationError } from "./workstation/errors.js";

const app = express();
app.use(express.json());

// LAN-only app (see docs/SECURITY.md) — permissive CORS so the dashboard,
// served from a different origin/port, can call this API.
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/workstations", workstationsRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof ConflictError) {
    res.status(409).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(env.port, () => {
  console.log(`dreamers-remote-server listening on :${env.port}`);
});
