import http from "node:http";
import express from "express";
import { env } from "./config/env.js";
import { workstationsRouter } from "./api/workstations.js";
import { authRouter } from "./api/auth.js";
import { agentRouter } from "./api/agent.js";
import { setupVncProxy } from "./remote/wsProxy.js";
import { sessionMiddleware } from "./auth/session.js";
import { requireAuth } from "./auth/middleware.js";
import { seedAdminUser } from "./auth/users.js";
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

server.listen(env.port, () => {
  console.log(`dreamers-remote-server listening on :${env.port}`);
});
