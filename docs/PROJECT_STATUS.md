# Project Status

Last updated: 2026-08-14

## Current milestone

**MILESTONE 1 COMPLETE.** Now starting **M2 — Backend workstation manager**.

## Completed

- M0 — Documentation (`README.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`,
  `docs/ROADMAP.md`, `docs/SECURITY.md`, `docs/SETUP.md`) and repo
  skeleton (`server/`, `web/`, `docker/`, `config/`, `scripts/`).
- M1 — `docker/docker-compose.yml` proof-of-concept: `noVNC` + `websockify`
  container proxying to a configurable UltraVNC target (`VNC_TARGET_HOST` /
  `VNC_TARGET_PORT` in `.env`). Never actually built/run (no Docker on the
  dev machine) — see "Known issues" for the follow-up needed.
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

- **M2 — Backend workstation manager**: Express API + SQLite + CRUD + TCP
  status probe, code written **and live-verified (2026-08-14)**. This dev
  machine still has no Node/npm, so verification happened on TrueNAS
  itself: Node 18.20.4/npm 9.2.0 installed (via `apt-get`, with `sudo`) into
  the `code-server` app's container (using its TrueNAS-provided Container
  Shell), the full `server/src` tree written there, then:
  - `npm install` — 122 packages, 0 vulnerabilities.
  - `npm run typecheck` (`tsc --noEmit`) — **0 errors**.
  - `npm test` — **16/16 tests pass** (validation + TCP probe suites).
  - `npm run build` — clean compile to `dist/`.
  - `node dist/index.js` then `curl localhost:8080/health` →
    `{"status":"ok"}`.
  - `POST /api/workstations` with a real workstation body → correctly
    persisted (id 1, `CGI-01`, `192.29.11.94`).
  - `GET /api/workstations/1/status` → `{"online":true,...}` — the TCP
    probe genuinely connected to `192.29.11.94:5900` over the LAN from
    TrueNAS, not a mock.
  This was a throwaway verification in `/tmp` inside the code-server
  container, not a deployment — the app dataset/real deployment location is
  still unset (see "Info still needed"). What's in the repo (`server/src/`):
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

- **M2 backend was verified in a throwaway location, not its real deployment
  path.** `npm install`/`typecheck`/`test`/`build`/live API calls all passed
  (see "In progress"), but that was in `/tmp` inside the `code-server`
  container on TrueNAS — not the actual `server/` checkout in this repo,
  and not through Docker/`server.Dockerfile`. Still needed: get this repo
  itself onto TrueNAS (see deployment note below) and rerun the same
  verification through `docker/server.Dockerfile` to confirm the container
  build (with its `apk add python3 make g++` step for `better-sqlite3`)
  works too — that path is still unverified.
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
  no on-TrueNAS build step required. Pushed; first run not yet confirmed
  green (see Next task).
- `web/` still only has skeleton scaffolding (package.json, tsconfig,
  placeholder page) — no application code yet. That's expected; M3 builds
  the dashboard once M2's API is verified working.

## Confirmed environment info

- **TrueNAS host IP: `192.29.11.92`** (confirmed by user 2026-08-14). App
  will be reachable at `http://192.29.11.92:<port>` once deployed there;
  M1 noVNC POC will be at `http://192.29.11.92:6080/vnc.html`.
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

- TrueNAS app port to bind on for the future server/web (defaulting to
  `8080` for the API, `6080` is now taken by the M1 `vncgi-remote` Dockge
  stack).
- TrueNAS pool name + dataset path for `DATA_ROOT` — pool candidates seen
  are `pool_cgivn_share` and `pool_cgivn_work` (latter already used for
  Apps), not yet told which to use for this project's data.
- `192.29.11.93` / `192.29.11.94`: MAC addresses (needed later for
  Wake-on-LAN, not blocking M1).
- **A real code-deployment path to TrueNAS for M2+** (git remote + SSH
  clone is the recommended default — see "Known issues" above — but not
  yet confirmed/set up).

Until provided, `.env.example` documents these as placeholders and nothing
depends on a guessed value.

## Next task

1. Get this repo's actual `server/` directory onto TrueNAS (not just a
   throwaway copy) and rerun `npm install && npm run typecheck && npm test
   && npm run build` there to confirm the checked-in code matches what was
   verified — then move on to verifying `docker/server.Dockerfile` builds
   correctly too. Still blocked on a real deployment mechanism (git remote
   + SSH clone recommended, see "Info still needed").
2. Once it's running from the real repo, register the two real workstations
   through the API (MAC
   addresses are placeholders below — **replace with real ones**, needed
   for M5 Wake-on-LAN; not required for CRUD/status to work today):
   ```bash
   curl -X POST http://localhost:8080/api/workstations \
     -H "Content-Type: application/json" \
     -d '{"name":"CGI-01","hostname":"CGI-01","ip":"192.29.11.94","mac_address":"00:00:00:00:00:00","vnc_port":5900,"location":"Studio"}'

   curl -X POST http://localhost:8080/api/workstations \
     -H "Content-Type: application/json" \
     -d '{"name":"COMP-01","hostname":"COMP-01","ip":"192.29.11.93","mac_address":"00:00:00:00:00:00","vnc_port":5900,"location":"Studio"}'

   curl http://localhost:8080/api/workstations/status
   ```
3. Fix the UltraVNC service misconfiguration on `192.29.11.94` (install as
   Windows service, not interactive process — fix instructions already
   handed to user) and check `192.29.11.93` for the same issue.
4. Decide and set up a real deployment path to TrueNAS (git remote + SSH
   clone recommended) so `server/` can actually be built there via
   `docker/server.Dockerfile` — Dockge alone can't build custom images from
   source.
5. Start M3 (web dashboard) once the M2 API above is confirmed working
   against real data.

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
