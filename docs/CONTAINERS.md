# Container Registry

Tracks every Docker container/service running for this project, per the
lifecycle rule in [DOCKER_LIFECYCLE.md](DOCKER_LIFECYCLE.md). Update this
file on every Docker-related change. No container should carry status
UNKNOWN once it's been possible to determine otherwise.

**Access note**: this agent has no shell/API access to the TrueNAS host
or Dockge — everything below for `vncgi-remote`/`vncgi-remote-93` comes
from the user opening each stack in Dockge and sharing its
compose.yaml + terminal log (2026-08-16); everything for
`vncgi-remote-server`/`vncgi-remote-web` comes from this repo's own
source/docs (`docker/*.Dockerfile`, `server/src/**`, `PROJECT_STATUS.md`),
cross-checked against how the app actually behaves in production
(session auth, WOL, agent heartbeats — all previously live-verified).
Raw `docker ps -a` / `docker images` / `docker volume ls` / `docker
network ls` output from the TrueNAS host itself has not been run —
ask the user for it if a future check needs to go beyond what's below.

## Summary

| Container | Status | Required | Phase |
|---|---|---|---|
| `vncgi-remote-server` | PRODUCTION | YES | V1 / Phase 2 |
| `vncgi-remote-web` | PRODUCTION | YES | V1 |
| `vncgi-remote` | DEPRECATED (removal confirmed, pending Dockge action) | NO | M1 (obsolete) |
| `vncgi-remote-93` | DEPRECATED (removal confirmed, pending Dockge action) | NO | M1 (obsolete) |

---

## `vncgi-remote-server`

- **Status**: PRODUCTION
- **Purpose**: Backend API (Express) + WebSocket VNC proxy (`/ws/vnc/:id`,
  `server/src/remote/wsProxy.ts`) + Wake-on-LAN sender + Agent endpoints
  (`/api/agent/*`) + SQLite-backed workstation/user/command_log storage.
- **Image**: `ghcr.io/rajnlove/dreamers-remote-server:latest`, built from
  [server.Dockerfile](../docker/server.Dockerfile).
- **Ports**: `8080` (API + WS proxy).
- **Volumes**: `${DATA_ROOT}` bind-mounted to `/data` (SQLite file —
  `dreamers-remote.sqlite`).
- **Networks**: `network_mode: host` — required for Wake-on-LAN's UDP
  broadcast to reach the physical LAN (a bridge network can't; see
  `docker-compose.yml` comment).
- **Environment**: `APP_PORT`, `DATABASE_FILE`, `DATA_ROOT`,
  `SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` (see
  `.env.example`).
- **Restart policy**: `unless-stopped`.
- **Dependencies**: none at the container level (SQLite is embedded, not
  a separate DB container). `vncgi-remote-web` calls this API.
- **Compose project/service**: repo's `docker/docker-compose.yml` defines
  a `server` service with this build; the live TrueNAS deployment is a
  standalone Dockge stack (own compose.yaml, not screenshotted/confirmed
  identical to the repo file, but same image/purpose per
  `PROJECT_STATUS.md`'s deploy instructions).
- **Created/managed by**: GitHub Actions
  (`.github/workflows/docker-build.yml`) builds+pushes on every push to
  `main`; deployed via Dockge → **Update** (not Deploy — see
  `PROJECT_STATUS.md`).
- **Cleanup condition**: never, while V1 is in use. Sessions are lost on
  restart (`MemoryStore`, expected).
- **Notes**: live-verified in production, daily use.

## `vncgi-remote-web`

- **Status**: PRODUCTION
- **Purpose**: React/Vite dashboard — workstation list, remote page,
  workstation detail page, login.
- **Image**: `ghcr.io/rajnlove/dreamers-remote-web:latest`, built from
  [web.Dockerfile](../docker/web.Dockerfile) (nginx, with SPA fallback
  via `docker/nginx.conf` — added 2026-08-16 after a real 404-on-refresh
  bug).
- **Ports**: `80` (container) — host mapping per Dockge stack, not the
  repo compose file's `5173:80` (that mapping is for local dev only).
- **Volumes**: none.
- **Networks**: default bridge (no `network_mode: host` needed — it only
  serves static files + calls the API over HTTP).
- **Environment**: none required at runtime (API base URL is baked in at
  build time via Vite env vars).
- **Restart policy**: `unless-stopped`.
- **Dependencies**: `vncgi-remote-server` (API calls, WS proxy).
- **Compose project/service**: same caveat as `vncgi-remote-server` —
  repo file vs. live Dockge stack not confirmed identical, but
  purpose/image match.
- **Created/managed by**: same CI pipeline as `vncgi-remote-server`.
- **Cleanup condition**: never, while V1 is in use.
- **Notes**: live-verified in production, daily use.

## `vncgi-remote` — DEPRECATED, confirmed 2026-08-16

- **Status**: DEPRECATED. Removal **confirmed by the user** (2026-08-16:
  the recent traffic below was their own testing, not another
  user/service) — cleared to remove, not yet actually deleted.
- **Purpose (historical)**: Milestone 1 proof-of-concept — standalone
  websockify + noVNC proxy, browser → this container → UltraVNC, before
  the DB-driven multi-workstation app existed.
- **Image**: `ghcr.io/rajnlove/dreamers-remote-novnc:latest` (confirmed
  via Dockge). This image is **no longer built** — its Dockerfile
  (`docker/novnc.Dockerfile`) and entrypoint
  (`docker/novnc-entrypoint.sh`) were deleted from the repo 2026-08-16,
  along with its service block in `docker/docker-compose.yml` and its
  build matrix entry in `.github/workflows/docker-build.yml`. GHCR may
  still hold old pushed tags of this image; not cleaned up (out of
  scope — registry cleanup, not container cleanup).
- **Ports**: `6080:6080`.
- **Volumes**: none (`networks: {}` in its compose.yaml — no explicit
  volumes either).
- **Environment**: `VNC_TARGET_HOST=192.29.11.94` (CGI-01),
  `VNC_TARGET_PORT=5900`.
- **Restart policy**: `unless-stopped`.
- **Dependencies / depended on by**: none in the current app — bypasses
  `vncgi-remote-server` entirely, connecting straight to CGI-01's
  UltraVNC. **This is the actual problem**: it's a second,
  *unauthenticated* path to CGI-01's VNC (no session login, unlike
  `/ws/vnc/:id` which requires `requireAuth`) — a live gap in the M6
  auth work, scoped to this one workstation.
- **Compose project/service**: standalone Dockge stack, own compose.yaml
  (confirmed via screenshot), `novnc` service — unrelated to the repo's
  `docker/docker-compose.yml` (that `novnc` service is gone from the
  repo now, but this stack has its own separate compose definition
  stored in Dockge, untouched by the repo cleanup).
- **Created/managed by**: unknown exactly who/when created this specific
  Dockge stack — predates any documentation. Not managed by CI in any
  ongoing sense (the image tag `:latest` was last pushed before the
  build target was removed 2026-08-16; it will not receive further
  updates).
- **Required for web remote?**: **No.** The current remote flow
  (`Browser → noVNC client lib (bundled in web/) → vncgi-remote-server's
  wsProxy.ts → UltraVNC`) does not call this container at all.
- **Cleanup condition**: user confirmed no dependency (was their own
  test traffic) → cleared. **STOP → VERIFY → REMOVE still pending** —
  needs the user to do it directly in Dockge (Dừng → Xóa); this agent
  has no Dockge access.
- **Notes**: terminal log showed real `ws://` connections to
  `/websockify` as recently as 15/Aug/2026 12:39.

## `vncgi-remote-93` — DEPRECATED, confirmed 2026-08-16

- **Status**: DEPRECATED. Same confirmation as `vncgi-remote` — cleared
  to remove, not yet actually deleted.
- **Purpose (historical)**: same M1 proof-of-concept, pointed at a
  different workstation (COMP-01) — likely created as a second manual
  test before the DB-driven app existed. The `93` suffix matches
  COMP-01's IP.
- **Image**: same `ghcr.io/rajnlove/dreamers-remote-novnc:latest` —
  same removal-from-repo status as `vncgi-remote` above.
- **Ports**: `6081:6080` (external `6081` so it doesn't collide with
  `vncgi-remote`'s `6080` on the same host).
- **Volumes**: none.
- **Environment**: `VNC_TARGET_HOST=192.29.11.93` (COMP-01),
  `VNC_TARGET_PORT=5900`.
- **Restart policy**: `unless-stopped`.
- **Dependencies / depended on by**: none in the current app — same
  unauthenticated-bypass concern as `vncgi-remote`, scoped to COMP-01.
- **Compose project/service**: standalone Dockge stack, own compose.yaml
  (confirmed via screenshot) — separate from the repo entirely.
- **Created/managed by**: unknown exactly who/when; not managed by CI
  going forward (same as `vncgi-remote`).
- **Required for web remote?**: **No** — same reasoning as
  `vncgi-remote`.
- **Cleanup condition**: cleared per user confirmation. **STOP → VERIFY
  → REMOVE still pending** in Dockge.
- **Notes**: terminal log showed connections as recently as
  15/Aug/2026 12:39:30. Also logged 2 hits from `192.168.1.3` — a
  subnet that doesn't match any known studio workstation
  (`192.29.11.x`) — not explained by the user's testing confirmation.
  Removing this container removes that access path regardless of what
  that IP was, but if `192.168.1.3` shows up again elsewhere later,
  it's worth tracking down what device that actually is.
