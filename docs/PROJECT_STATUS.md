# Project Status

Last updated: 2026-08-16

> Handoff snapshot, not a changelog. Detailed history (what changed,
> why, what broke and how it got fixed) lives in `git log` — each
> milestone has one commit with a full message. Read recent commits for
> the story behind a decision, not this file. Long-term direction lives
> in [MASTER_PROJECT_SPEC.md](MASTER_PROJECT_SPEC.md); this file is
> current state only.

## Current Phase

**Phase 2 — Dreamers Agent** (monitoring + safe management). Phase 1
(Web Remote) is done and in daily use. Nothing from Phase 3 onward
(Job Engine, Processing, Render Farm, Performance Remote, Studio
Control Center, Studio OS Integration — see MASTER_PROJECT_SPEC.md) has
been started; do not start any of it without an explicit request.

## Current Milestone

**P2-8 — Restart/Shutdown commands.** Code complete (server, Agent,
web), builds and unit-tests clean. **Not yet live-verified** — nobody
has clicked Restart against a real workstation yet.

## Completed

- **V1, Milestones 1-6**: workstation manager (CRUD, TCP online/offline
  probe), dashboard, integrated remote page (noVNC), Wake-on-LAN
  sending, single-admin session auth. Live-verified, daily use.
- **Phase 2, P2-0 through P2-7**: Agent skeleton, system/GPU/disk/process
  metrics, Agent↔server registration+heartbeat, dashboard live-metrics
  integration, per-workstation detail page. Live-verified, daily use.
- **Phase 2, P2-9**: bulk agent deployment doc — written up in
  [agent/README.md](../agent/README.md#deploying-to-multiple-workstations-bulk).
- **Docker container audit**: all 4 known TrueNAS containers classified
  (see Docker Status below), full detail in
  [CONTAINERS.md](CONTAINERS.md). No container left at UNKNOWN.
- **Docker lifecycle policy adopted**: [DOCKER_LIFECYCLE.md](DOCKER_LIFECYCLE.md),
  referenced from `CLAUDE.md`.
- **Obsolete M1 `novnc` service removed from the repo**: Dockerfile,
  entrypoint, compose service, CI build target, and doc references all
  removed/updated 2026-08-16 (user confirmed no live dependency).

## In Progress

- **P2-8 live verification** — blocked on deploying the new
  `DreamersAgent.exe` to a real, non-CGI-Render workstation and clicking
  Restart/Shutdown for real. See "Next Task".
- **Remote-session latency + multi-monitor tuning** — `TCP_NODELAY`,
  WS compression off, noVNC quality tuning, and a "100% (SCROLL TO
  PAN)" mode are all coded and pushed, but **not confirmed working on
  real hardware**. A first attempt at the pan feature (noVNC
  `clipViewport`/`dragViewport`) looked correct from source but turned
  out broken when actually tested — treat the current scroll-based
  version with the same caution until someone confirms it live.
- **Deprecated Docker containers (`vncgi-remote`, `vncgi-remote-93`)** —
  removal confirmed by the user, repo-side cleanup done, but the live
  Dockge stacks themselves are not yet stopped/deleted (this agent has
  no Dockge access to do it).

## Known Issues

- **Wake-on-LAN doesn't wake real hardware** (`COMP-01`, `CGI-DUC`) even
  though the server-side magic-packet send is verified working.
  Suspected NIC/BIOS limitation (`HPE Ethernet 10Gb 561FLR-T`, S5 wake
  support unconfirmed). On hold, deprioritized by the user.
- **Admin password is still the throwaway default** (`admin`/`admin`).
  No in-app change-password UI exists yet.
- **CPU temperature not implemented.** No clean Windows API without a
  kernel-mode driver (which Phase 2's spec rules out); a WMI best-effort
  read is unreliable across BIOSes. User hasn't decided if it's worth
  adding on those terms.
- **`192.168.1.3` unexplained** in `vncgi-remote-93`'s access log (2
  hits, timeout + 404) — a subnet outside the known studio LAN range.
  Not resolved by the user's "it was my testing" confirmation for the
  rest of that traffic. Worth tracking down if it resurfaces.
- **CGI-DUC multi-monitor capture** — root cause diagnosed (UltraVNC's
  `vnchook.dll`-based capture doesn't reliably follow multi-monitor
  coordinates; user unchecked "System HookDll" in UltraVNC → Capture),
  but whether that alone fixed it (does FIT TO SCREEN now show both
  monitors?) was never confirmed.

## Next Task

In order:

1. Deploy the new single-file `DreamersAgent.exe` (see
   agent/README.md) to one of CGI-01 / COMP-01 / CGI-DUC — **not
   CGI-Render**, since that's the machine this agent runs on and a real
   restart/shutdown there would kill the session. Click Restart or
   Shutdown from that workstation's detail page and confirm the full
   loop: command queued → delivered on next heartbeat → Agent executes
   → `command_log` shows the result.
2. Stop and delete the `vncgi-remote` and `vncgi-remote-93` stacks
   directly in Dockge (Dừng → Xóa) — repo-side cleanup is already done,
   this is the only remaining step.
3. On CGI-DUC, confirm whether FIT TO SCREEN now shows both monitors
   after the UltraVNC HookDll change, then test SCROLL TO PAN for real.

## Tests Performed

- `dotnet build Dreamers.Agent.sln` / `dotnet test` — clean, 35/35
  passing (Agent + Core). Re-run after every Agent-side change this
  session, including the single-file installer rework.
- **Node.js installed on this machine 2026-08-16** (v24.19.0 LTS, plus
  Python 3.12 for `better-sqlite3`'s native build — this machine already
  had MSVC Build Tools 2026, so Python was the only missing piece).
  First time `server/`'s own typecheck/test/build could be run directly
  instead of relying solely on CI:
  - `npm run typecheck` — caught 2 real type errors on first run
    (`req.params.id` narrowed to `string | undefined`;
    `Duplex.setNoDelay` doesn't exist, needed a `net.Socket` cast for
    the P2-8 TCP_NODELAY fix). Both fixed; clean on re-run.
  - `npm test` — 31/31 passing.
  - `npm run build` — clean.
  - `web/`'s `npm run typecheck` / `npm run build` — also run for the
    first time this session; both clean, no errors found.
  - `package-lock.json` committed for both `server/` and `web/` for the
    first time (never existed before — Node wasn't available to
    generate one); Dockerfiles updated to `npm ci` instead of
    `npm install` for reproducible builds now that a lockfile exists.
- CGI-Render's Agent service verified live after a manual P2-8 update
  (stop → replace binary → start): clean startup log, heartbeats
  succeeding every 5s.
- **Not tested**: the web app in an actual browser this session (no
  direct browser access to the deployed dashboard); the double-click
  installer flow (`HandleInteractiveSetupAsync`) on a real fresh-or-
  already-installed machine; P2-8's Restart/Shutdown end-to-end on any
  real workstation.

## Required User Action

- **Push 4 pending commits** to `main` (Docker lifecycle policy,
  container audit + confirmation, novnc removal, expanded audit +
  roadmap) — commits exist locally, awaiting confirmation to push.
- Deploy the Agent build and live-test P2-8 (see Next Task #1).
- Delete the 2 deprecated Dockge stacks (see Next Task #2).
- Confirm the CGI-DUC multi-monitor fix (see Next Task #3).
- Eventually: change the admin password; decide on CPU temperature.

## Docker Status

Per [DOCKER_LIFECYCLE.md](DOCKER_LIFECYCLE.md). Full detail (image,
ports, volumes, environment, dependencies, cleanup condition) in
[CONTAINERS.md](CONTAINERS.md) — this is the quick-glance summary.
Audited 2026-08-16; no container left at UNKNOWN.

**PRODUCTION**
- `vncgi-remote-server` — backend API + WS VNC proxy + WOL + Agent
  endpoints. Required, live, daily use.
- `vncgi-remote-web` — dashboard (nginx). Required, live, daily use.

**TEST** — none currently tracked.

**TEMPORARY** — none currently tracked.

**FUTURE** — none currently tracked.

**DEPRECATED**
- `vncgi-remote` — M1-era standalone `novnc` proxy hardcoded to CGI-01
  (port 6080). Superseded by `vncgi-remote-server`'s `wsProxy.ts`; was
  a real security gap while running (reachable with no dashboard login
  at all). User confirmed 2026-08-16 the recent traffic was their own
  testing — removal cleared. Repo-side cleanup done; **live Dockge
  stack still needs to be stopped/deleted by the user.**
- `vncgi-remote-93` — same situation, hardcoded to COMP-01 (port 6081).
  Same confirmation, same pending Dockge deletion. See "Known Issues"
  for the one unexplained `192.168.1.3` log entry.

## Active Workers

The 4 workstations currently paired with Dreamers Agent — all live,
all agent-paired. (These serve V1/Phase 2's current scope; they have
not yet been assigned the future GPU-slot/render-worker roles described
in MASTER_PROJECT_SPEC.md §3, which is a separate, later planning
exercise.)

| Name | id | IP | Hostname | Hardware |
|---|---|---|---|---|
| CGI-01 | 1 | 192.29.11.94 | RAJN | i9-14900K, RTX 5090, 128GB |
| COMP-01 | 2 | 192.29.11.93 | CGIVN | i9-13900K, RTX 5070 Ti, 128GB |
| CGI-Render | 3 | 192.29.11.95 | DESKTOP-FE5VNUN | i9-9900X, 2x RTX 3090, 65GB — **this is the machine Claude Code itself runs on** |
| CGI-DUC | 4 | 192.29.11.98 | DAN075 | Ryzen 9 9950X, RTX 5070 Ti, 190GB |

All have real MACs set (`PATCH /api/workstations/:id`) and UltraVNC
installed by the user. All run `DreamersAgent` as an installed Windows
Service (not just `dotnet run`), registered with the server, sending
heartbeats every 5s.

## Architecture Decisions

- **V1**: React/Vite dashboard (`web/`) + Express/TypeScript API
  (`server/`) + SQLite, on TrueNAS via Docker Compose/Dockge. Remote
  desktop = Browser → noVNC (bundled client lib) → backend WS proxy
  (`/ws/vnc/:id`) → raw TCP → UltraVNC. **Frontend never sends a
  host/IP to the WS proxy, only a `workstationId`** — backend resolves
  it from the DB. Full detail: [ARCHITECTURE.md](ARCHITECTURE.md),
  [SECURITY.md](SECURITY.md).
- **Phase 2 (Dreamers Agent)**: `agent/` is a separate .NET 8 Worker
  Service (`DreamersAgent.exe`) per workstation — collects CPU/RAM/GPU
  (NVML, multi-GPU)/disk/VFX-process metrics every 5s, sends heartbeats,
  shown live on the dashboard and a per-workstation detail page.
  **Completely independent of the VNC path** — either subsystem can
  change without the other caring. Agent auth: token-based one-time
  pairing → long-lived credential, DPAPI-encrypted at rest, sent via
  `X-Agent-Id`/`X-Agent-Credential` headers — separate from the
  session-cookie auth used everywhere else. Restart/shutdown commands
  (P2-8) ride the existing heartbeat response rather than being pushed
  — the Agent has no inbound listener by design. Design doc:
  [SECURITY.md](SECURITY.md#phase-2--dreamers-agent-authentication-design-implemented-in-p2-5).
  Build/deploy procedure: [agent/README.md](../agent/README.md).
- API bodies use snake_case matching DB columns 1:1 (`mac_address`, not
  `macAddress`).
- `better-sqlite3` (sync), not an async driver — simpler for a
  single-writer local DB.
- TCP connect probe for online/offline, not ICMP (containers can't
  raw-socket ping reliably).
- VNC password entered in-browser via noVNC, never touches the backend
  — avoids making the backend a secrets store (V1 tradeoff, see
  SECURITY.md).
- No Kubernetes/Redis/message queues/microservices — single Compose
  stack sized for 4-20 LAN workstations.
- Agent build packaged as a single self-contained `.exe`
  (`PublishSingleFile`) with an interactive double-click
  install/update flow — chosen over a multi-file zip + manual
  PowerShell procedure after direct user feedback that recipients may
  not be technical.

## Live infrastructure — do not guess these, verify if unsure

- **TrueNAS host**: `192.29.11.92`. Dashboard: `http://192.29.11.92:8000`
  (login `admin`/`admin` — still the throwaway default, see "Known
  Issues"). API: `http://192.29.11.92:8080`. Dockge (container
  manager): `http://192.29.11.92:31014`.
- **Deploy via Dockge**: click into the stack (`vncgi-remote-server` or
  `vncgi-remote-web`) → **Update** button. **Not "Deploy"** — Deploy
  recreates from whatever image is already cached locally and silently
  skips pulling the new one from GHCR, so a real code change won't
  actually take effect. This has bitten this project before (M6's CORS
  bug shipped this way). Update pulls first, then recreates.
  - GitHub Actions (`.github/workflows/docker-build.yml`) builds+pushes
    `server`/`web` images to GHCR on every push to `main` (paths:
    `server/**`, `web/**`, `docker/**`). Check
    https://github.com/rajnlove/dreamers-remote/actions is green before
    deploying.
- **Sessions don't survive a server redeploy** — `express-session` uses
  `MemoryStore` (fine for one instance, no Redis), so restarting
  `vncgi-remote-server` logs everyone out. Expected, not a bug; just
  log back in.
- **If `192.29.11.92` suddenly seems unreachable** (ping/curl timeout),
  check this machine's own network adapters first
  (`Get-NetAdapter` in PowerShell) before assuming TrueNAS is down —
  happened once already (a studio-LAN NIC silently dropped link).
- **Credentials/tokens are never entered by the agent, even if the user
  provides them or asks directly** — Dockge login, dashboard login,
  Windows admin prompts, anything password-shaped. This is a hard rule
  held all session regardless of how it's asked; the user does these
  steps themselves.

## Important commands

```bash
# Server + web (Node.js — installed on this machine 2026-08-16, v24.19.0
# LTS; run "npm install" once per checkout, it's not committed)
cd server && npm install && npm run typecheck && npm test && npm run build
cd web && npm install && npm run typecheck && npm run build
# CI (GitHub Actions) remains the authoritative gate for what actually
# ships — these are for local iteration.

# Agent (needs .NET 8 SDK — IS available on this machine)
cd agent
dotnet build Dreamers.Agent.sln
dotnet test Dreamers.Agent.sln
dotnet publish Dreamers.Agent -c Release -r win-x64 -o .\dist
# ^ produces exactly one DreamersAgent.exe (single-file, self-contained
# — target workstations need NO .NET installed). Double-click it there;
# it auto-detects install vs. update. See agent/README.md.
```

## Info still needed from user (do not guess)

- TrueNAS pool name + dataset path, if/when SQLite data should move off
  Dockge's default bind-mount (`./data`) onto a proper named dataset —
  candidates seen: `pool_cgivn_share`, `pool_cgivn_work`. Nothing
  currently depends on this.
