import http from "node:http";
import express from "express";
import { env } from "./config/env.js";
import { workstationsRouter } from "./api/workstations.js";
import { authRouter } from "./api/auth.js";
import { agentRouter } from "./api/agent.js";
import { jobsRouter } from "./api/jobs.js";
import { workersRouter } from "./api/workers.js";
import { setupVncProxy } from "./remote/wsProxy.js";
import { sessionMiddleware } from "./auth/session.js";
import { requireAuth } from "./auth/middleware.js";
import { seedAdminUser, seedServiceUser } from "./auth/users.js";
import { ConflictError, NotFoundError, ValidationError } from "./workstation/errors.js";

const app = express();
app.use(express.json());

// LAN-only app (see docs/SECURITY.md). Cookies now carry the session, so
// CORS must reflect the actual request origin + allow credentials —
// browsers reject "*" as Access-Control-Allow-Origin for credentialed
// requests. Still permissive in spirit: any LAN origin is accepted, same
// posture as the wildcard this replaces.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
  }
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(sessionMiddleware);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/workstations", requireAuth, workstationsRouter);
// P3-1: no scheduler yet, just CRUD — see docs/ROADMAP.md's Phase 3 section.
app.use("/api/jobs", requireAuth, jobsRouter);
// P3-2: read-only capability + GPU slot view, derived from Agent heartbeats.
app.use("/api/workers", requireAuth, workersRouter);
// Not behind requireAuth — the Agent has no user session. Each route
// authenticates itself (registration token / agent credential). See
// docs/SECURITY.md and api/agent.ts.
app.use("/api/agent", agentRouter);

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

const server = http.createServer(app);
setupVncProxy(server, sessionMiddleware);

if (env.adminPassword) {
  seedAdminUser(env.adminUsername, env.adminPassword).catch((err: unknown) => {
    console.error("Failed to seed admin user:", err);
  });
} else {
  console.warn(
    "ADMIN_PASSWORD not set — no admin user will be created. " +
      "Login will not work until it's provided and the server restarted.",
  );
}

// P4-5: PHP Projects site's service account, non-admin -- see
// auth/users.ts's seedServiceUser doc comment. Off by default (no
// PHP_SERVICE_PASSWORD set); nothing warns when it's unset, unlike the
// admin account above, since not every deployment needs PHP integration.
if (env.phpServicePassword) {
  seedServiceUser(env.phpServiceUsername, env.phpServicePassword).catch((err: unknown) => {
    console.error("Failed to seed PHP service account:", err);
  });
}

if (env.uploadServicePassword) {
  if (env.uploadServicePassword.length < 32) throw new Error("UPLOAD_SERVICE_PASSWORD must contain at least 32 characters");
  await seedServiceUser(env.uploadServiceUsername, env.uploadServicePassword);
}

server.listen(env.port, () => {
  console.log(`dreamers-remote-server listening on :${env.port}`);
});
