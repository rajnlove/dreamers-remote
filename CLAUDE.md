# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

Dreamers Remote V1 — internal web app for the studio LAN: list Windows
workstations, show online/offline, remote into them via UltraVNC + noVNC,
Wake-on-LAN. Runs on TrueNAS SCALE via Docker Compose.

## Rules

- V1 does not implement custom capture/codec/streaming (no NVENC, no P2P, no
  internet relay). That's V2 — document only, never implement. See
  [docs/ROADMAP.md](docs/ROADMAP.md).
- Reuse UltraVNC + noVNC + websockify. Do not build a remote-desktop engine.
- No Kubernetes, Redis, Kafka, GraphQL, microservices, event sourcing unless
  a real need shows up later.
- Frontend never sends an arbitrary host/IP to the WS proxy — only a
  `workstationId`; backend resolves IP from the database.
- No plaintext VNC passwords in frontend code or git history. Secrets via env
  vars / Docker secrets only.
- TypeScript strict mode, no `any` without a comment explaining why.
- Work one milestone at a time (see [docs/ROADMAP.md](docs/ROADMAP.md)).
  Implement → run → test → fix → update `docs/PROJECT_STATUS.md` before
  moving on.
- Always keep [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) current — it's
  the source of truth for what's done and what's next.
- Every Docker container/service/image/volume/network must have a documented
  purpose and lifecycle status (PRODUCTION/TEST/TEMPORARY/FUTURE/DEPRECATED)
  in [docs/CONTAINERS.md](docs/CONTAINERS.md) — no unexplained containers.
  Never run `docker system prune -a` or delete anything on the TrueNAS host
  without confirming no dependency/data loss first. Full rule:
  [docs/DOCKER_LIFECYCLE.md](docs/DOCKER_LIFECYCLE.md).
