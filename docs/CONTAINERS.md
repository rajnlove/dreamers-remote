# Container Registry

Tracks every Docker container/service running for this project, per the
lifecycle rule in [DOCKER_LIFECYCLE.md](DOCKER_LIFECYCLE.md). Update this
file on every Docker-related change.

| Container | Status | Purpose | Required | Phase | Notes |
|---|---|---|---|---|---|
| `vncgi-remote-server` | PRODUCTION | Backend API (Express) + WebSocket VNC proxy (`/ws/vnc/:id`) + Wake-on-LAN sender + Agent endpoints (`/api/agent/*`) | YES | V1 / Phase 2 | Deployed via Dockge → **Update** (not Deploy — see `PROJECT_STATUS.md`). `network_mode: host` for WOL. |
| `vncgi-remote-web` | PRODUCTION | React/Vite dashboard, served via nginx | YES | V1 | Same Dockge Update caveat as above. |
| `vncgi-remote` | **UNDER REVIEW** | Unconfirmed — see hypothesis below | UNKNOWN | — | Needs inspection on the TrueNAS host (see `PROJECT_STATUS.md` open items) |
| `vncgi-remote-93` | **UNDER REVIEW** | Unconfirmed — see hypothesis below | UNKNOWN | — | `93` matches COMP-01's IP (`192.29.11.93`) |

## Under-review containers — working hypothesis, not confirmed

Nobody has inspected either of these directly (this agent has no
TrueNAS/Dockge access — only what's visible via the repo and what the
user reports). Based on code archaeology, not live inspection:

- **`vncgi-remote`** (no suffix) is a plausible match for the Milestone 1
  proof-of-concept `novnc` service defined in
  [docker-compose.yml](../docker/docker-compose.yml) (built from
  [novnc.Dockerfile](../docker/novnc.Dockerfile) — a standalone
  websockify + noVNC static-file container, pointed at one hardcoded
  `VNC_TARGET_HOST`). **The current architecture doesn't use this
  anymore**: `web/` bundles the noVNC *client library*
  (`@novnc/novnc` npm package) directly into the React app, and the
  *server-side* proxy is `server/src/remote/wsProxy.ts`, running inside
  `vncgi-remote-server` itself — there is no separate proxy container in
  the current design (see `ARCHITECTURE.md`). If `vncgi-remote` really
  is running the old `novnc` service, it's architecturally superseded
  and a DEPRECATED candidate, not PRODUCTION.
- **`vncgi-remote-93`**: the `93` suffix matching COMP-01's IP suggests a
  one-off M1-era test of that same `novnc` service, hardcoded to one
  workstation, from before the DB-driven multi-workstation model existed.
  Likely TEMPORARY/leftover, not PRODUCTION.

**Do not act on this hypothesis alone.** Per the lifecycle rule, before
removing either: confirm via Dockge (or `docker ps -a` / `docker
inspect` on the TrueNAS host) what compose definition and image each
one actually runs, whether it's currently started, and whether
anything (DNS, a bookmark, another container) depends on it. See the
audit request in `docs/PROJECT_STATUS.md`.
