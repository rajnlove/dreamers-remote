# Project Status

Last updated: 2026-08-15

## Current milestone

**V1 (MILESTONES 1-6) COMPLETE.** Now starting **Phase 2 — Dreamers
Agent** (monitoring + safe management, see
[ARCHITECTURE.md](ARCHITECTURE.md#phase-2--dreamers-agent-monitoring--safe-management)
and [ROADMAP.md](ROADMAP.md#phase-2--dreamers-agent-monitoring--safe-management)).
V1 leftovers (Wake-on-LAN hardware investigation, on hold; changing the
throwaway `admin`/`admin` password) are tracked in "Next task" below and
are independent of Phase 2 — Phase 2 does not block on them.

## Phase 2 — Dreamers Agent

**MILESTONE P2-6 (2026-08-15) — code complete, pending build/deploy
verification.**

- **P2-0**: docs updated (`ARCHITECTURE.md`, `ROADMAP.md`, `SECURITY.md`,
  this file) with the Phase 2 design — separate subsystem, does not
  touch the VNC remote-desktop path, three independent online signals
  (`machineOnline`/`agentOnline`/`vncOnline`), agent identity is a
  persistent UUID (never IP-based), token-based pairing +
  DPAPI-protected local credential storage for agent auth (see
  `SECURITY.md`).
- **P2-1**: `agent/Dreamers.Agent` (.NET 8 Worker Service,
  `DreamersAgent.exe` — service host, `install`/`uninstall`/`start`/
  `stop` CLI wrapping `sc.exe`), `agent/Dreamers.Agent.Core`
  (`AgentConfig`/`AgentConfigStore` — identity + config persistence to
  `C:\ProgramData\DreamersRemote\agent.json`, generates the UUID once
  and never regenerates it; `RollingFileLogger*` — daily-rotating file
  logger, 14-day retention, never throws even if a write fails).
  **Build-verified (2026-08-15)** after the user installed .NET 8 SDK
  (8.0.424) on the `CGI-Render` machine: `dotnet build` → 0
  warnings/errors, `dotnet test` → 6/6 passed, `dotnet run` run twice
  confirmed identical `AgentId` across restarts (persistence, not
  regeneration) and correct console+file logging. Did **not** run
  `DreamersAgent.exe install` — creating a live Windows Service is
  treated as "modifying system settings" (same boundary held all
  session for UltraVNC etc.), left for the user to run themselves per
  `agent/README.md` whenever they want a real installed instance.
- **P2-2**: added `agent/Dreamers.Agent.Core/Metrics/`: `CpuCollector`
  (stateful — `GetSystemTimes` P/Invoke, delta-based utilization; first
  sample always returns `null` since there's nothing to diff against
  yet, by design), `MemoryCollector` and `OperatingSystemInfo` (WMI
  `Win32_OperatingSystem`), `CpuIdentity` (WMI `Win32_Processor`, cached
  at startup since name/core count don't change at runtime),
  `SystemUptime` (`GetTickCount64` P/Invoke), `AgentVersionReader`.
  `MetricsCollector` orchestrates all of them with **per-collector
  try/catch isolation** — a failing collector logs a warning and leaves
  its section `null` in the snapshot rather than crashing the tick (the
  pattern P2-3's GPU/NVML collector will reuse, since that's the one
  actually expected to fail on non-NVIDIA machines). Both
  `Dreamers.Agent.Core` and `Dreamers.Agent` retargeted from `net8.0` to
  **`net8.0-windows`** to fix 12 `CA1416` platform-compatibility
  warnings from the WMI calls — correct anyway, since this project is
  Windows-only by design. Verified live on `CGI-Render`: `dotnet build`
  → 0 warnings/0 errors, `dotnet test` → 11/11 passed (5 new tests),
  `dotnet run` logged real data — `Intel(R) Core(TM) i9-9900X CPU @
  3.50GHz` (20 logical/10 physical cores), first tick correctly showed
  `CpuUsage=n/a (first sample)`, second tick showed a sane `3.2%`, RAM
  `12840/65210MB (19.7%)`, real OS caption/uptime.

- **P2-3**: added `agent/Dreamers.Agent.Core/Metrics/GpuCollector.cs` +
  `NvmlNativeMethods.cs` (P/Invoke bindings for the small NVML slice
  needed: init, device count, handle-by-index, name, utilization,
  memory info, temperature — no NuGet wrapper, matches this project's
  low-dependency style). Supports multiple GPUs (`SystemMetricsSnapshot.Gpus`,
  a list, never null). **Never crashes on a machine without an NVIDIA
  GPU**: `nvmlInit_v2()` is wrapped in try/catch for
  `DllNotFoundException` (no driver → no `nvml.dll` → this exception,
  expected and handled) and `EntryPointNotFoundException` (driver too
  old/new); either way `Collect()` just returns an empty list, exactly
  like every other collector's failure mode via `MetricsCollector`'s
  existing per-collector isolation.
  **Verified against real hardware** on `CGI-Render` (this machine has
  2x NVIDIA GeForce RTX 3090): `dotnet build` → 0 warnings/0 errors,
  `dotnet test` → 14/14 passed (3 new GPU tests), `dotnet run` logged
  both real GPUs correctly — `GPU0="NVIDIA GeForce RTX 3090" Util=0%
  VRAM=374/24576MB (1.5%) Temp=37C | GPU1="NVIDIA GeForce RTX 3090"
  Util=15-16% VRAM=904/24576MB (3.7%) Temp=44C` — matching the exact
  multi-GPU scenario described in the Phase 2 spec. The "no GPU present"
  fallback path itself was not exercised on real hardware (this machine
  has GPUs) — it's covered by the `DllNotFoundException`/
  `EntryPointNotFoundException` catch blocks and by
  `GpuCollector_NeverThrows` in the test suite, but hasn't been run on
  an actual non-NVIDIA machine. Worth a spot-check later if one becomes
  available, not blocking.

- **P2-4**: added `DiskCollector` (`DriveInfo.GetDrives()`, filters to
  `DriveType.Fixed` + `IsReady` — no NAS shares, no directory scanning,
  per Phase 2 scope) and `ProcessCollector` (checks a configurable list
  of VFX process names/patterns against `Process.GetProcesses()`; a
  trailing `*` in a pattern like `Nuke*.exe` does a prefix match, since
  Nuke's exe name embeds its version). The monitored list persists to
  `C:\ProgramData\DreamersRemote\monitored_processes.json` via
  `MonitoredProcessesConfigStore` (same load-or-create-with-defaults
  pattern as `AgentConfigStore`; hand-edits are preserved, a corrupted
  file falls back to defaults instead of crashing) with the exact
  default list from the Phase 2 spec (`AfterFX.exe`, `Cinema4D.exe`,
  `houdini.exe`, `houdinifx.exe`, `hbatch.exe`, `hython.exe`,
  `Nuke*.exe`, `maya.exe`, `3dsmax.exe`, `blender.exe`). Both wired into
  `MetricsCollector` with the same per-collector isolation as
  CPU/RAM/GPU. Per-process detail (PID, RAM, start time) is
  best-effort — wrapped in its own try/catch since `Process.StartTime`
  can throw Access Denied for some processes even when other properties
  succeed.
  Build+run-verified on `CGI-Render`: `dotnet build` → 0 warnings/0
  errors, `dotnet test` → 22/22 passed (8 new tests), `dotnet run`
  logged all 7 real local drives (`C:` through `J:`, actual sizes) and
  correctly reported `0/10` monitored apps running (none of the listed
  VFX apps were open at the time — the "not running" path, not the
  "running" one, though `ProcessCollectorTests` exercises "running" too
  by matching the test process itself).

- **P2-5 (code complete, 2026-08-15) — implements the exact design from
  `SECURITY.md`**:
  - **Server** (`server/src/agent/`, `server/src/api/agent.ts`):
    - `crypto.ts` — `generateSecret`/`hashSecret`/`secretMatchesHash`.
      SHA-256, not scrypt: registration tokens and agent credentials are
      already high-entropy random secrets, not human passwords, so the
      slow-hash reasoning behind `auth/password.ts`'s scrypt doesn't
      apply here. 5 unit tests.
    - `database/db.ts` — **real migration**, not just `CREATE TABLE IF
      NOT EXISTS` (which only affects brand-new databases): a new
      `ensureColumn()` helper checks `PRAGMA table_info` and
      `ALTER TABLE ADD COLUMN`s if missing, idempotent, runs on every
      boot. Adds `agent_id` (unique, nullable), `agent_credential_hash`,
      `last_seen`, `agent_version`, `os` to `workstations`; new
      `agent_registration_tokens` table.
    - `registrationTokens.ts` — admin issues a 15-minute single-use
      token (`POST /api/workstations/:id/agent-token`, behind the
      existing `requireAuth` session middleware); `consumeRegistrationToken`
      validates + marks it used in one step.
    - `agentRepository.ts` — `pairAgent` (stores the credential
      **hashed**, never plaintext), `verifyAgentCredential` (deliberately
      doesn't distinguish "unknown agent" from "wrong credential" in its
      return value, to avoid leaking which agent ids exist),
      `recordHeartbeat`.
    - `middleware.ts` — `requireAgentAuth`, reads `X-Agent-Id` +
      `X-Agent-Credential` headers. Completely separate from the
      session-cookie `requireAuth` used by `/api/workstations/*` — a
      leaked agent credential can only send heartbeats for its own
      workstation, never reach the rest of the API or the VNC proxy.
    - `metricsCache.ts` — **in-memory only**, deliberately not persisted
      to SQLite every heartbeat (would turn SQLite into a time-series
      DB, explicitly against the project's minimalism — see
      `ROADMAP.md`). Lost on server restart; repopulates within one
      heartbeat interval.
    - `POST /api/agent/register` / `POST /api/agent/heartbeat` — mounted
      at `/api/agent`, **not** behind `requireAuth` (the Agent has no
      user session; each route authenticates itself).
    - Deliberately deferred to P2-6 (not built now, to avoid scope
      creep): an `isAgentOnline(lastSeen)` helper and exposing any of
      this through `/api/workstations` responses — P2-5 is ingestion
      only, P2-6 is "put it on the dashboard."
  - **Agent** (`agent/Dreamers.Agent.Core/{Credentials,Server}/`):
    - `AgentCredentialStore` — the credential is encrypted at rest via
      **Windows DPAPI** (`LocalMachine` scope, since the service runs as
      `LocalSystem` rather than a specific interactive user), never
      plaintext on disk. 4 unit tests (round-trip, "file doesn't contain
      the plaintext", corrupted-file fallback).
    - `ServerClient` — typed `HttpClient` wrapper for
      `RegisterAsync`/`SendHeartbeatAsync`; `HeartbeatPayload` maps
      `SystemMetricsSnapshot` to the wire format (mainly: `TimeSpan
      Uptime` → `double UptimeSeconds`, since the server has no reason
      to parse .NET's `TimeSpan` string format).
    - `DreamersAgent.exe register <token>` — new CLI command, calls
      `/api/agent/register` once and stores the returned credential via
      DPAPI. Matches the `SECURITY.md` pairing flow: admin issues a
      token from the dashboard, runs this once on the workstation.
    - `Worker.cs` — after collecting + logging metrics locally (as
      before), sends the same snapshot as a heartbeat **if and only if**
      a credential exists; a missing credential logs one warning
      ("not registered yet") rather than erroring every tick. Heartbeat
      failures (server down, network blip) are caught and logged as
      warnings — local metrics collection/logging already happened
      regardless, so a bad heartbeat never affects the agent's own
      health. Same per-collector-style isolation philosophy as
      `MetricsCollector`, just at the network layer.
    - **Bug caught and fixed while wiring this up**: `AgentConfig`'s
      default `ServerUrl` had been `https://192.29.11.92:8080` since
      P2-1 — wrong, since the deployed server is plain HTTP (no TLS cert
      configured, see `SECURITY.md`). Every registration/heartbeat
      attempt would have failed outright. Fixed the default for future
      installs, and hand-patched `CGI-Render`'s already-existing
      `agent.json` to match.
  - **Build+test-verified (agent side)**: `dotnet build` → 0
    warnings/0 errors, `dotnet test` → 26/26 passed (8 new tests).
    Server side not build-verified locally (no Node/npm on this
    machine) — written carefully, reviewed by hand; **CI confirmed it
    (run #7, commit `36d8530`, green)**.
  - **LIVE END-TO-END TEST PASSED (2026-08-15)**, on real infrastructure
    end to end: pushed → CI green → redeployed `vncgi-remote-server` via
    Dockge's **Update** button (pulled the new image; a mid-session
    network drop on `CGI-Render`'s studio-LAN NIC delayed this, unrelated
    to the code — see below) → issued a real registration token for
    `CGI-Render` (id 3) via `POST /api/workstations/3/agent-token` using
    an authenticated browser session → ran `DreamersAgent.exe register
    <token>` for real on `CGI-Render` → "Registered successfully" →
    ran the agent, watched it send two real heartbeats
    (`POST /api/agent/heartbeat` → `200`, ~13-143ms) → confirmed via
    `GET /api/workstations/3` that `agent_id`, `agent_version` (`1.0.0.0`),
    `os` (`Microsoft Windows 11 Pro for Workstations`), and `last_seen`
    all updated correctly, and `agent_credential_hash` is a hash, never
    the plaintext credential. Every piece of the P2-5 design — token
    issuance, one-time registration, DPAPI-stored credential, heartbeat
    auth via `X-Agent-Id`/`X-Agent-Credential` headers, in-memory metrics
    cache — is now proven working against real infrastructure, not just
    unit tests.
  - **Unrelated infra hiccup hit mid-milestone, not a code bug**: this
    machine's studio-LAN NIC (`Ethernet 4`, the same HPE 10Gb card
    discussed in the Wake-on-LAN investigation) silently dropped link
    partway through, making `192.29.11.92` unreachable (ping and TCP
    connect both failed) until the user checked `Get-NetAdapter` and
    found it — cable/switch-port issue, not a TrueNAS or app problem.
    Worth remembering if `192.29.11.92` seems to vanish again: check
    `Get-NetAdapter` locally before assuming the server is down.

- **P2-6 (code complete, 2026-08-15)** — Dashboard integration:
  - **Server**: `GET /api/workstations/status` now returns `vncOnline`
    (unchanged TCP probe, renamed from `online`), `agentOnline`
    (`agent/onlineStatus.ts` — heartbeat freshness, 20s threshold),
    `lastSeen`, and `metrics` (the cached snapshot from P2-5's
    in-memory cache, `null` if the workstation has no Agent paired or
    it hasn't sent a heartbeat recently). Two independent signals, not
    one boolean, per the Phase 2 spec — a workstation can be `vncOnline`
    without `agentOnline` (no Agent installed yet) or vice versa
    (Agent up, UltraVNC down). `machineOnline` (a third signal from the
    original spec, roughly "is the box powered on regardless of any
    service") was **not** added — no cheap reliable way to get it in
    this Docker/Node environment (ICMP needs raw sockets, ARP is more
    machinery than this V1-scale app needs); `vncOnline` already serves
    as the practical "is it reachable" signal.
  - **Security fix caught along the way**: `GET /api/workstations/:id`
    (and the list endpoint) were using `SELECT *`, which — once P2-5
    added `agent_credential_hash` to the `workstations` table — started
    leaking that hash in API responses to any logged-in user (confirmed
    happening during the P2-5 live test). Fixed by switching
    `workstation/repository.ts` to an explicit column list that excludes
    it; nothing depends on the hash existing outside `agentRepository.ts`.
  - **Web**: `WorkstationCard` now renders CPU/RAM/GPU (one bar per GPU
    for multi-GPU machines)/VRAM+temp bars when `agentOnline` and
    metrics exist, plus a running-apps list (only the apps actually
    `running: true`, from the monitored-process list); an "AGENT"
    badge shows agent online/offline separately from the existing VNC
    online dot. **Existing REMOTE/WAKE button logic is untouched** —
    still driven by `vncOnline` alone, exactly as before P2-6.
  - **Not yet build-verified**: same as P2-5, no Node/npm locally: CI
    is the real gate. Not yet deployed/live-tested either — needs both
    `vncgi-remote-server` (API changes) and `vncgi-remote-web`
    (dashboard changes) redeployed via Dockge, unlike P2-1 through P2-5
    which only touched the server or the agent alone.

Next: after CI + live verification, **P2-7** (workstation detail page,
`/workstations/:id`).

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

## Completed (M6 detail)

- **MILESTONE 6 COMPLETE (2026-08-15).** Dashboard and `/ws/vnc/:id`
  proxy are both authenticated — single admin account, session cookies,
  login confirmed working live by the user at `http://192.29.11.92:8000`.

**Design**: single admin account seeded from env vars on first boot
(`ADMIN_USERNAME`/`ADMIN_PASSWORD`), password hashed with Node's built-in
`crypto.scrypt` (no new native dependency), `express-session` for cookie
sessions (MemoryStore — fine for one instance, no Redis). Both the REST
API (`requireAuth` middleware) and the `/ws/vnc/:id` proxy (manually
invoking the same `sessionMiddleware` inside the raw `upgrade` handler,
since that bypasses Express's normal pipeline) are protected — protecting
only the REST side would leave the VNC proxy reachable by guessing a
small workstation id.

**Files changed (all local only as of this writing)**:
- New: `server/src/auth/{password,password.test,users,session,middleware}.ts`,
  `server/src/api/auth.ts`, `web/src/api/auth.ts`, `web/src/pages/Login.tsx`.
- Modified: `server/src/database/db.ts` (added `users` table),
  `server/src/config/env.ts` (added `sessionSecret`/`adminUsername`/
  `adminPassword`), `server/src/remote/wsProxy.ts` (session check before
  upgrade), `server/src/index.ts` (session middleware, CORS now reflects
  origin + credentials instead of `*`, mounts `/api/auth`, protects
  `/api/workstations`, seeds admin on boot), `server/package.json` (added
  `express-session` + `@types/express-session`, test script includes
  `src/auth/*.test.ts`), `.env.example` (added `ADMIN_USERNAME`/
  `ADMIN_PASSWORD`), `web/src/App.tsx` (auth-gated routing, `/login`
  route), `web/src/pages/Dashboard.tsx` (takes `user`/`onLogout` props,
  logout button), `web/src/api/workstations.ts` (`credentials: "include"`
  on all requests), `web/src/styles.css` (`.login-*`, `.dashboard-header`,
  `.dashboard-user` rules).

**Hard blocker RESOLVED (2026-08-15)**: user provided `admin`/`admin` as
the initial `ADMIN_USERNAME`/`ADMIN_PASSWORD`, explicitly as a throwaway
first-login credential — **user asked to be reminded to change it after
first login.** Whoever is at the keyboard when this is deployed: nag the
user to change it. There's no in-app "change password" flow yet (V1 has
no user-management UI at all, single seeded account only), so "changing
it" means updating `ADMIN_PASSWORD` in Dockge's env vars and wiping the
`users` table row (or the whole SQLite file) so `seedAdminUser` reseeds
on next boot — not elegant, but that's the real procedure until a
change-password endpoint exists.

Static review of all M6 files done (no local Node/npm available to run
`tsc`/tests directly — CI's `npm run build` inside `docker/web.Dockerfile`
is the real gate). No issues found.

**DEPLOYED (2026-08-15)**: `vncgi-remote-server` Dockge env vars now
include `ADMIN_USERNAME=admin`, `ADMIN_PASSWORD=admin`, and a freshly
generated `SESSION_SECRET` (64-char random hex, replacing the insecure
dev default) — added via Dockge's compose editor, deployed with the
"Deploy" button (container recreated, confirmed `running` and `GET
/health` returns `200 {"status":"ok"}`). `vncgi-remote-web` updated to
the latest image via the "Update" button (nginx workers restarted).
`http://192.29.11.92:8000` confirmed live-rendering the new login page
(USERNAME/PASSWORD fields, LOG IN button) instead of the old dashboard.

**Bug found and fixed post-deploy (2026-08-15)**: user hit "Failed to
fetch" on the login page. Root cause — Dockge's "Deploy" button (used
right after editing the compose env vars) recreates the container from
whatever image is already cached locally; it does **not** pull the new
image from GHCR. `vncgi-remote-server` was still running the pre-M6
image (wildcard `Access-Control-Allow-Origin: *`), which browsers
reject for credentialed requests — every `fetch(..., {credentials:
"include"})` failed CORS before even reaching the server. Fixed by
clicking **Update** (not just Deploy) on `vncgi-remote-server`, which
pulls the latest image first. Confirmed via curl (`OPTIONS
/api/auth/me` now returns `Access-Control-Allow-Origin:
http://192.29.11.92:8000` + `Access-Control-Allow-Credentials: true`,
not `*`) and via an in-page `fetch` from the real browser (`401
{"error":"Not authenticated"}` — correct pre-login response, no CORS
error). **Lesson for future deploys: always use Update (pulls image),
not Deploy (recreates from cache), when a new image was just pushed to
GHCR** — Deploy is only sufficient for compose/env-var-only changes to
a stack whose image hasn't changed.

**Confirmed live by user (2026-08-15)**: logged in for real with
`admin`/`admin` at `http://192.29.11.92:8000`, reached the dashboard.
Full auth flow (login → session cookie → protected API + WS proxy)
verified end-to-end. **Still outstanding**: `admin`/`admin` is a
throwaway first-login credential (user's own explicit choice, with an
explicit ask to be reminded to change it) — no in-app change-password
flow exists yet, so change it via Dockge `ADMIN_PASSWORD` env var +
wiping the `users` table row (or the whole SQLite file) so
`seedAdminUser` reseeds on next restart.

**Known easy-to-miss gotcha already solved once, don't redo the mistake**:
CORS changed from `Access-Control-Allow-Origin: *` to reflecting
`req.headers.origin` + `Access-Control-Allow-Credentials: true` — required
for cookies to work cross-port (dashboard :8000, API :8080). Session
cookie is `sameSite: "lax", secure: false` deliberately (plain HTTP, same
IP different ports counts as same-site for SameSite purposes).

## Completed (M5 detail)

- **MILESTONE 5 COMPLETE (2026-08-15).** Wake-on-LAN wired end-to-end:
  - `server/src/wol/wol.ts` — `buildMagicPacket(mac)` constructs the
    standard 102-byte packet (6× `0xFF` + MAC repeated 16×);
    `sendMagicPacket` broadcasts it over UDP (`dgram`, port 9, no new npm
    dependency — Node's built-in `dgram` module was enough). Packet
    construction is unit tested (`wol.test.ts`, 4 tests: correct length,
    correct byte layout, hyphen-separated MAC input, rejects malformed
    input); the actual UDP send isn't unit tested since it needs a real
    network.
  - `POST /api/workstations/:id/wake` — looks up the workstation, 400s
    with a clear message if `mac_address` is still the unset
    `00:00:00:00:00:00` placeholder, otherwise sends the packet and
    returns `{ sent: true }`.
  - `web/src/components/WorkstationCard.tsx` — `WAKE` button now calls
    the real endpoint (pending state while sending, alert with the
    backend's actual error message on failure — e.g. surfaces "mac_address
    is not set" verbatim instead of a generic HTTP error).
  - **Real infrastructure gotcha found and fixed**: a UDP broadcast sent
    from inside Docker's default bridge network never reaches the
    physical LAN (broadcast is scoped to the bridge's own isolated
    subnet). Fixed by setting `network_mode: host` on the `server` service
    in both `docker/docker-compose.yml` (repo reference) and the live
    `vncgi-remote-server` Dockge stack (edited directly via a JS
    `HTMLTextAreaElement` value-setter + `input`/`change` event dispatch
    on Dockge's compose editor — much more reliable for this editor than
    the character-by-character keydown simulation used earlier for
    xterm-based shells). `network_mode: host` and `ports:` are mutually
    exclusive in Compose, so the `ports:` mapping was removed too — with
    host networking the container binds `APP_PORT` directly on the host,
    no publish mapping needed.
  - **Verified live after redeploy**: `curl -i -X POST
    http://192.29.11.92:8080/api/workstations/1/wake` → `HTTP/1.1 400`,
    body `{"error":"mac_address is not set for this workstation"}` —
    confirms the endpoint, validation, and host-networked container all
    work correctly end-to-end. Existing SQLite data survived the
    networking change (still shows both workstations, both online).
  - **Not yet verified**: an actual magic packet reaching real hardware
    and waking it, since both registered workstations still have the
    `00:00:00:00:00:00` placeholder MAC (see "Info still needed" — this
    has been an open item since M2). Once real MACs are set via `PATCH
    /api/workstations/:id`, this should be tested for real: power off a
    workstation, click WAKE, confirm it boots.

## Completed (M4 detail)

- **MILESTONE 4 COMPLETE (2026-08-14).** Real noVNC viewer, proxied
  through the backend — not a redirect to the separate per-workstation
  Dockge stacks from M1 anymore:
  - `server/src/remote/wsProxy.ts` — WebSocket endpoint at
    `/ws/vnc/:id`, attached to the shared `http.Server` (not a separate
    Express route, since it needs the raw `upgrade` event). Validates the
    id against the DB (404s if unknown or `enabled: false`), resolves
    `ip`/`vnc_port` server-side, then bridges WS binary frames to a raw
    `net.Socket` to UltraVNC in both directions, buffering client->server
    bytes until the TCP leg connects. Frontend never sends a host/IP —
    only the id in the URL — per [ARCHITECTURE.md](ARCHITECTURE.md) and
    [SECURITY.md](SECURITY.md).
  - `web/src/pages/RemotePage.tsx` — replaced the M3 placeholder with a
    real `@novnc/novnc` `RFB` instance connected to
    `${WS_BASE_URL}/ws/vnc/:id`. `scaleViewport = true` by default (no
    more manual "Local Scaling" gear-icon step from M1). Toolbar: live
    connection status pill, Ctrl+Alt+Del, fullscreen (Fullscreen API),
    disconnect/reconnect (remounts the RFB instance). VNC password is
    collected via a small in-page overlay form on the RFB
    `credentialsrequired` event and sent straight to `rfb.sendCredentials`
    — never touches our REST API or gets logged, per the V1 tradeoff
    documented in [SECURITY.md](SECURITY.md).
  - `web/src/types/novnc.d.ts` — `@novnc/novnc` ships no TypeScript
    types; added a minimal ambient module declaration covering only what
    RemotePage uses.
  - **Build fix required and shipped**: `@novnc/novnc` uses top-level
    `await` (H264 WebCodecs feature detection), which esbuild's default
    target list rejects. Fixed by setting `build.target: "esnext"` in
    `web/vite.config.ts`.
  - **CI caught a real bug before deployment**: the first push (commit
    `d471a96`) failed the `web` Docker build in GitHub Actions on exactly
    that top-level-await error — reproduced locally on TrueNAS via the
    `code-server` Container Shell (`git pull && npm run build`) to get a
    readable error message (GitHub's job-log API needs auth this session
    didn't have), fixed, verified the fix builds clean in the same shell,
    then pushed and confirmed CI green before touching any Dockge stack.
  - **Verified live end-to-end**: `vncgi-remote-server` and
    `vncgi-remote-web` stacks updated to the new images via Dockge's
    Update button (existing SQLite data survived, per M3). Opened the
    dashboard, clicked REMOTE on `COMP-01` (`192.29.11.93`) — the
    WebSocket proxy connected through to real UltraVNC, RFB handshake
    succeeded, and the custom password overlay appeared requesting
    credentials. Did not enter the password (agent policy: never handle
    credentials) — connection setup verified up to that point, which is
    the part that depends on this milestone's code; password entry and
    the resulting desktop render depend on the user, not on anything
    built this session.
  - **`CGI-01` (`192.29.11.94`) hit UltraVNC's own brute-force lockout**
    ("Security negotiation failed... rejected too many attempts") during
    this same test, almost certainly from the many connection attempts
    made across this session's earlier M1 testing. Not a bug in this
    milestone's code — confirmed by `COMP-01` connecting cleanly through
    the identical code path. Needs either a wait for UltraVNC's lockout
    timer to expire or a service restart on `.94` to clear it.

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
- **Two new workstations added to the fleet (2026-08-15)**:
  - **`CGI-Render`** (id 3, `192.29.11.95`, hostname `DESKTOP-FE5VNUN`) —
    this is the machine this Claude Code session itself runs on. UltraVNC
    installed **by the user** (agent policy: never download/run
    installers or modify system/security settings, even on request —
    same boundary applied here as for git push and Dockge logins). Agent
    helped only with read-only diagnostics (locating `winvnc.exe`,
    confirming `uvnc_service` was `Running` and port `5900`
    `LISTENING`, checking the firewall rule already existed) and with
    registering the workstation via the API once VNC was confirmed
    working. Installed correctly as a Windows service from the start
    (`uvnc_service`, not an interactive process) — the `.93`/`.94`
    service misconfiguration was not repeated here.
  - **`CGI-DUC`** (id 4, `192.29.11.98`) — added at user's request,
    real MAC confirmed via `ipconfig /all` cross-checked against the
    adapter actually carrying `192.29.11.98`.

## Info still needed from user (do not guess these)

- ~~Real MAC addresses for `192.29.11.93` / `192.29.11.94`~~ **RESOLVED
  (2026-08-15)** — user ran `ipconfig /all` on each machine and supplied
  the real Physical Address of the adapter actually carrying that
  workstation's LAN IP (not just any adapter listed — `CGI-DUC`'s first
  answer was accidentally the MAC of a disconnected Wi-Fi adapter, caught
  and corrected by cross-checking which adapter's IPv4 matched). All four
  registered workstations now have real MACs, `PATCH`ed via
  `/api/workstations/:id`:
  - `CGI-01` (id 1, `192.29.11.94`): `30:68:93:68:B4:62`
  - `COMP-01` (id 2, `192.29.11.93`): `48:DF:37:16:B7:35`
  - `CGI-Render` (id 3, `192.29.11.95`, new — this machine): `48:DF:37:0B:DD:31`
  - `CGI-DUC` (id 4, `192.29.11.98`, new): `14:02:EC:7D:70:00`
  Real Wake-on-LAN hasn't been tested against real hardware yet (power
  off, click WAKE, confirm it boots) — still open, see "Next task".
- TrueNAS pool name + dataset path if/when the `server`'s SQLite data should
  move off the Dockge stack's default bind-mount location (`./data`, inside
  wherever Dockge stores `vncgi-remote-server`) onto a proper named
  dataset — pool candidates seen are `pool_cgivn_share` and
  `pool_cgivn_work` (latter already used for Apps).

Until provided, nothing depends on a guessed value.

## Next task

1. **Wake-on-LAN real-hardware test — ON HOLD (2026-08-15), deprioritized
   by user.** Tested against `COMP-01` and `CGI-DUC`: the server confirms
   `{"sent": true}` for every wake request (magic packet construction +
   UDP broadcast is verified working, not a bug in this app), but neither
   machine actually powered on. Both use the same NIC family
   (`HPE Ethernet 10Gb 2-port 561FLR-T`, a FlexibleLOM card) for their
   studio-LAN connection — investigated live: `CGI-DUC` had "Wake on
   PCIe" enabled in BIOS and still didn't wake. Suspected causes, not yet
   confirmed one way or the other: (a) this NIC/driver may not expose a
   "Wake on Magic Packet" option at all (check Device Manager → NIC →
   Advanced tab — if the option isn't listed, the card doesn't support
   it), (b) HPE boards often use a distinct BIOS setting
   (`S5 Wake on LAN` under Advanced Power Management, separate from
   generic "Wake on PCIe"), (c) Windows Fast Startup can interfere, (d) a
   BIOS change may need one full Windows boot + clean shutdown cycle
   before it takes effect. **User asked to set this aside for now** —
   pick back up by checking (a) first, since that determines whether this
   is even possible on the current hardware without moving the studio-LAN
   cable to a different (WOL-capable) NIC.
2. **Change the admin password** — `admin`/`admin` was only ever meant as
   a throwaway first-boot placeholder (M6 login confirmed working live
   2026-08-15). No in-app change-password flow exists yet; see the
   procedure noted in "Completed (M6 detail)" above (update
   `ADMIN_PASSWORD` in Dockge, wipe the `users` row/DB, restart).
3. **Deploy P2-6 and verify live** — push, wait for CI, redeploy BOTH
   `vncgi-remote-server` and `vncgi-remote-web` via Dockge (**Update**,
   not just Deploy), confirm the dashboard shows real CPU/RAM/GPU
   metrics for `CGI-Render` (the one workstation currently paired with
   an Agent) and that REMOTE/WAKE still work unchanged.

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
