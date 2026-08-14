# Project Status

Last updated: 2026-08-14

## Current milestone

**MILESTONE 1 COMPLETE. MILESTONE 2 COMPLETE. MILESTONE 3 COMPLETE
(2026-08-14).** Next up: **M4 — integrated remote page**.

## Completed

- M0 — Documentation (`README.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`,
  `docs/ROADMAP.md`, `docs/SECURITY.md`, `docs/SETUP.md`) and repo
  skeleton (`server/`, `web/`, `docker/`, `config/`, `scripts/`).
- M1 — `docker/docker-compose.yml` proof-of-concept: `noVNC` + `websockify`
  container proxying to a configurable UltraVNC target (`VNC_TARGET_HOST` /
  `VNC_TARGET_PORT` in `.env`).
- **`docker/novnc.Dockerfile` confirmed working in production (2026-08-14):**
  both Dockge stacks now run the real
  `ghcr.io/rajnlove/dreamers-remote-novnc:latest` image (built by CI, see
  below) instead of the placeholder `dougw/novnc`:
  - `vncgi-remote`: `ghcr.io/rajnlove/dreamers-remote-novnc:latest`, port
    `6080:6080`, `VNC_TARGET_HOST=192.29.11.94`, `VNC_TARGET_PORT=5900`.
  - `vncgi-remote-93`: same image, port `6081:6080`,
    `VNC_TARGET_HOST=192.29.11.93`.
  Both verified with `curl` (HTTP 200 on `/`). The repo's own Dockerfile is
  no longer just theoretical — it's what's actually running.
- M1 — `scripts/test-host.sh`, `scripts/test-vnc.sh` for checking a
  workstation is reachable before wiring it into the app.
- **MILESTONE 1 COMPLETE (2026-08-14)** — live end-to-end remote confirmed
  by user on both test workstations, via Dockge stacks on TrueNAS:
  - `vncgi-remote` → `192.29.11.94`, `http://192.29.11.92:6080/vnc.html`
  - `vncgi-remote-93` → `192.29.11.93`, `http://192.29.11.92:6081/vnc.html`
  Both reached a real UltraVNC desktop after entering the VNC password.
  One client-side snag hit and resolved: noVNC's default Scaling Mode is
  `None`, so on a smaller viewer screen than the remote resolution, only
  part of the desktop was visible — fixed by setting Scaling Mode to
  `Local Scaling` in noVNC's settings (gear icon). This is a per-tab
  browser setting, not persisted — **M4's `/remote/:id` page should default
  to Local Scaling** so users don't have to set it manually each time.

## In progress

**M4 — integrated remote page** not yet started. `/remote/:id` currently
shows a placeholder (see "Completed (M3 detail)") pointing users at the
already-running per-workstation noVNC deploys instead of an embedded
viewer. M4 replaces that with a real noVNC viewer resolved through the
backend (per [ARCHITECTURE.md](ARCHITECTURE.md): frontend sends only
`workstationId`, backend resolves IP — no `/ws/vnc/:workstationId` proxy
exists yet, so this is genuinely not built, not just unwired).

## Completed (M3 detail)

- **MILESTONE 3 COMPLETE (2026-08-14).** Web dashboard built and deployed
  live:
  - Deployed as its own Dockge stack `vncgi-remote-web`, running
    `ghcr.io/rajnlove/dreamers-remote-web:latest` (nginx serving the Vite
    build), port `8000:80`. Live at `http://192.29.11.92:8000`.
  - `web/src/pages/Dashboard.tsx` — fetches `GET /api/workstations` once,
    polls `GET /api/workstations/status` every 5s, renders one
    `WorkstationCard` per workstation (green/red dot, name, IP,
    ONLINE/OFFLINE label).
  - `web/src/components/WorkstationCard.tsx` — shows a `REMOTE` link
    (`/remote/:id`) when online, a `WAKE` button when offline (currently
    just alerts "not implemented yet" — real Wake-on-LAN is M5).
  - `web/src/pages/RemotePage.tsx` — placeholder route, fetches the single
    workstation via `GET /api/workstations/:id` and tells the user the
    real noVNC viewer is M4; not a dead end, just honest about scope.
  - `web/src/api/workstations.ts` — calls the backend directly at
    `http://192.29.11.92:8080` (hardcoded default, overridable via
    `VITE_API_BASE_URL` at build time — no nginx reverse proxy set up, see
    architecture note below).
  - **Backend change required and shipped**: added permissive CORS
    middleware to `server/src/index.ts` (`Access-Control-Allow-Origin: *`)
    since the dashboard (port 8000) and API (port 8080) are different
    origins. Acceptable for a LAN-only app per
    [SECURITY.md](SECURITY.md); redeployed to `vncgi-remote-server` via
    Dockge's Update button, confirmed header present and existing
    workstation data survived the redeploy (bind-mounted SQLite).
  - Verified live in-browser: dashboard shows both real workstations as
    ONLINE with correct IPs, clicking REMOTE navigates to `/remote/1` and
    correctly resolves `CGI-01` / `192.29.11.94` from the live API.
  - Architecture note for whoever picks up M4: the frontend calling the
    backend's LAN IP:port directly (no reverse proxy) is a deliberate V1
    simplification, not a workaround to revisit lightly — changing it
    means either adding an nginx `/api` proxy (requires the web and server
    containers to share a Docker network, which two independent Dockge
    stacks don't by default) or keeping direct calls and formalizing the
    env var. Not blocking M4.

## Completed (M2 detail)

- **MILESTONE 2 COMPLETE (2026-08-14).** Express API + SQLite + CRUD + TCP
  status probe — written, tested, and **now actually deployed and serving
  real data**, not just verified in a throwaway location:
  - Deployed as its own Dockge stack `vncgi-remote-server` on TrueNAS,
    running `ghcr.io/rajnlove/dreamers-remote-server:latest` (built by the
    same CI pipeline as the `novnc` image), port `8080:8080`, SQLite
    persisted via bind mount `./data:/data`.
    `GET http://192.29.11.92:8080/health` → `{"status":"ok"}`.
  - Both real workstations registered through the live API:
    `POST /api/workstations` → `CGI-01` (id 1, `192.29.11.94`) and
    `COMP-01` (id 2, `192.29.11.93`), both `mac_address` still the
    `00:00:00:00:00:00` placeholder (real MACs still needed, see "Info
    still needed").
    `GET /api/workstations/status` →
    `[{"id":1,"name":"CGI-01","online":true},{"id":2,"name":"COMP-01","online":true}]`
    — the TCP probe correctly reports both as online, live from the
    running deployment.
  - Earlier verification steps (all passed, see git history for detail):
    `npm install` (122 packages, 0 vulnerabilities), `npm run typecheck`
    (0 errors), `npm test` (16/16 pass), `npm run build`, plus an identical
    rerun from the real GitHub clone (not just a throwaway `/tmp` copy).
  - What's in the repo (`server/src/`):
  - `server/src/database/db.ts` — opens `better-sqlite3` at
    `env.databaseFile`, creates the `workstations` table if missing
    (`id, name, hostname, ip, mac_address, vnc_port, location, description,
    enabled, created_at, updated_at`, `name` UNIQUE).
  - `server/src/workstation/types.ts`, `validation.ts`, `errors.ts`,
    `repository.ts`, `status.ts` — domain types, input validation
    (IPv4/MAC/port format checks, required vs. partial-update rules),
    typed error classes (`ValidationError`/`NotFoundError`/`ConflictError`),
    CRUD against SQLite, and the TCP connect probe
    (`checkTcpPort(host, port, timeoutMs)`, default 1000ms timeout).
  - `server/src/api/workstations.ts` — wired into `server/src/index.ts`:
    `GET/POST /api/workstations`, `GET/PATCH/DELETE /api/workstations/:id`,
    `GET /api/workstations/status`, `GET /api/workstations/:id/status`.
    Central error-handling middleware maps the three error types to
    400/404/409.
  - `server/src/workstation/validation.test.ts`,
    `server/src/workstation/status.test.ts` — `node:test` based unit tests
    for validation rules and the TCP probe (open port / refused port /
    timeout), run via `npm test` (`tsx --test src/workstation/*.test.ts`).
  - `docker/server.Dockerfile` updated: both build and runtime stages now
    `apk add python3 make g++` (removed again in the runtime stage after
    `npm install`) because `better-sqlite3` compiles a native addon on
    install and Alpine/musl doesn't reliably have prebuilt binaries for it.
- While testing M1, found and is being fixed on the workstation side: on
  `192.29.11.94`, UltraVNC was running as an interactive process, not a
  Windows service (see "Confirmed environment info" below). `.93` not yet
  checked for the same issue but likely has it too, since both machines
  were probably set up the same way. Not blocking M2 (that's a
  workstation-side fix, independent of backend code).

## Known issues / blockers

- **Git deployment path RESOLVED (2026-08-14):** repo pushed to
  `https://github.com/rajnlove/dreamers-remote` (public, deliberately kept
  public after discussing tradeoffs with user — no secrets in the repo, so
  the added complexity of a private repo + PAT-based auth on TrueNAS wasn't
  worth it). Cloned successfully into the `code-server` app's container on
  TrueNAS (`~/dreamers-remote`) via its Container Shell; `npm install` +
  `typecheck` + `test` all pass identically from the real clone (16/16
  tests), matching the earlier throwaway `/tmp` verification.
- **Docker build gap RESOLVED via CI (2026-08-14):** since nothing on
  TrueNAS can `docker build` our custom Dockerfiles (`code-server`'s
  container has `git` but no Docker CLI/socket; Dockge has real Docker
  access but no build/file-upload capability), added
  `.github/workflows/docker-build.yml` — builds `docker/server.Dockerfile`,
  `docker/web.Dockerfile`, `docker/novnc.Dockerfile` on every push to
  `main` and publishes to GHCR as `ghcr.io/rajnlove/dreamers-remote-{server,web,novnc}:latest`
  (+ a `:<git-sha>` tag). Dockge only ever needs to pull a tagged image —
  no on-TrueNAS build step required. **First run confirmed green
  (2026-08-14)** — all 3 images built and verified publicly pullable from
  GHCR. **`novnc` and `server` images deployed and live (2026-08-14)** —
  see "Completed" for both. `web` image builds in CI but has nothing real
  inside it yet (skeleton only) — not deployed, not useful to deploy until
  M3 has actual dashboard code.
- `web/` still only has skeleton scaffolding (package.json, tsconfig,
  placeholder page) — no application code yet. That's the next milestone.

## Confirmed environment info

- **TrueNAS host IP: `192.29.11.92`** (confirmed by user 2026-08-14).
  Backend API live at `http://192.29.11.92:8080`; noVNC at
  `http://192.29.11.92:6080/vnc.html` (`.94`) and
  `http://192.29.11.92:6081/vnc.html` (`.93`).
- **Workstation `192.29.11.94`** (confirmed by user 2026-08-14), UltraVNC
  installed, port `5900` confirmed open, RFB handshake verified live via
  M1 test (see below). **Known issue**: UltraVNC was running as an
  interactive process (`winvnc.exe`, Session ID 1), not as a Windows
  service — no `uvnc_service` registered. This means it does not survive
  reboot/logoff, and is the likely cause of an intermittent "wrong VNC
  password after a few days" symptom the user reported. Fix instructions
  (install as service, fix password write location, verify Session ID 0)
  handed to the user as a standalone prompt for a local Claude Code
  session on that machine — fix not yet confirmed applied.
- **Workstation `192.29.11.93`** (confirmed by user 2026-08-14), UltraVNC
  also installed. Not yet verified for the same service-vs-interactive
  issue found on `.94` — should be checked with the same diagnostic
  commands, likely has the same misconfiguration since both were probably
  set up the same way.

## Info still needed from user (do not guess these)

- Real MAC addresses for `192.29.11.93` / `192.29.11.94` — currently
  registered with placeholder `00:00:00:00:00:00`. Not blocking CRUD/status
  (works fine today), but required before M5 Wake-on-LAN can work.
- TrueNAS pool name + dataset path if/when the `server`'s SQLite data should
  move off the Dockge stack's default bind-mount location (`./data`, inside
  wherever Dockge stores `vncgi-remote-server`) onto a proper named
  dataset — pool candidates seen are `pool_cgivn_share` and
  `pool_cgivn_work` (latter already used for Apps).

Until provided, nothing depends on a guessed value.

## Next task

1. Start M4 (integrated remote page): backend needs a
   `POST /api/workstations/:id/session` (or similar) plus a WebSocket
   proxy (`/ws/vnc/:workstationId`) that resolves the workstation's
   IP/port server-side (per [ARCHITECTURE.md](ARCHITECTURE.md) and
   [SECURITY.md](SECURITY.md) — frontend must never send a host/IP
   directly). Frontend: replace `RemotePage`'s placeholder with an
   embedded noVNC viewer pointed at that proxy, defaulting Scaling Mode to
   `Local Scaling` (see M1 note), plus fullscreen/disconnect/reconnect and
   Ctrl+Alt+Del if feasible.
2. Fix the UltraVNC service misconfiguration on `192.29.11.94` (install as
   Windows service, not interactive process — fix instructions already
   handed to user) and check `192.29.11.93` for the same issue.
3. Get real MAC addresses for `192.29.11.93`/`.94` from the user and PATCH
   them onto workstation ids 1/2 before M5 (Wake-on-LAN).

## Important commands

```bash
# M1 — bring up noVNC/websockify POC only (server/web also defined in the
# compose file for later milestones, but aren't needed for M1).
# --project-directory . is required: the compose file lives in docker/, so
# without it Compose resolves .env and relative volumes from docker/ instead
# of the repo root.
docker compose --project-directory . -f docker/docker-compose.yml up -d novnc
docker compose --project-directory . -f docker/docker-compose.yml logs -f novnc
docker compose --project-directory . -f docker/docker-compose.yml down

# Check a workstation is reachable before wiring it in
scripts/test-host.sh <ip>
scripts/test-vnc.sh <ip> <port>

# M2 — backend (once Node is available)
cd server
npm install
npm run typecheck
npm test
npm run dev        # http://localhost:8080/health
```

## Architecture decisions

- **API request/response bodies use snake_case field names matching the DB
  columns 1:1** (`mac_address`, `vnc_port`, not `macAddress`/`vncPort`).
  Deliberate simplification for V1: avoids a camelCase<->snake_case mapping
  layer that adds no real value at this scale, and matches the JSON example
  already in this spec's data model section.
- **better-sqlite3, not an async SQLite driver.** Synchronous API keeps the
  repository layer simple (no promise chains for what's a local, fast,
  single-writer database); Express handlers stay async only where the TCP
  probe genuinely needs it.
- **TCP connect probe, not ICMP ping**, for online/offline (containers
  often can't send raw ICMP; TCP-to-VNC-port is also a more meaningful
  "can we actually remote into this" check). See
  [ARCHITECTURE.md](ARCHITECTURE.md).
- **Frontend never sends a host/IP to the WS proxy** — only a
  `workstationId`; backend resolves the IP. Prevents the proxy from
  becoming an open relay. See [SECURITY.md](SECURITY.md).
- **VNC password entered in-browser via noVNC** (not stored/handled by the
  backend) for V1, to avoid making the backend a secrets store. Documented
  tradeoff in [SECURITY.md](SECURITY.md) — can revisit later if the studio
  wants passwordless "click Remote" UX.
- **SQLite now, schema portable to PostgreSQL later** — explicit
  timestamps, no SQLite-specific types in app code.
- **No Kubernetes / message queues / microservices** — single Compose
  stack, sized for 4-20 workstations on a LAN.
