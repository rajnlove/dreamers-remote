# Project Status

Last updated: 2026-08-16

> Handoff snapshot, not a changelog. Detailed history (what changed,
> why, what broke and how it got fixed) lives in `git log` — each
> milestone has one commit with a full message. Read recent commits for
> the story behind a decision, not this file. Long-term direction lives
> in [MASTER_PROJECT_SPEC.md](MASTER_PROJECT_SPEC.md); this file is
> current state only.

## Current Phase

**Phase 3 — Dreamers Job Engine.** Started 2026-08-16 (explicit user
request — "qua phase 3"). Phase 1 (Web Remote) and Phase 2 (Dreamers
Agent) are both complete and in daily use; Phase 2 has one known
deferred issue (P2-8 Restart/Shutdown doesn't work on real hardware yet
— see Known Issues). Milestone breakdown for Phase 3 is in
[ROADMAP.md](ROADMAP.md#phase-3--dreamers-job-engine) (P3-0 through
P3-8). **Nothing from Phase 4 onward is started** — per the user's own
rule, do not start any of it without an explicit request.

## Current Milestone

**P3-5 — Job lifecycle (cancel/retry/failure handling)**, up next.
P3-1 through P3-4 are done — the full job engine loop now works
end-to-end (create → schedule → deliver → execute → report), just with
only a trivial built-in `test` job type and no UI to drive it yet
(that's P3-7):
- P3-1: `jobs` table, `server/src/job/` (types, validation,
  repository), `POST/GET /api/jobs`, `GET /api/jobs/:id`,
  `POST /api/jobs/:id/cancel` — all behind `requireAuth`.
- P3-2: Agent reports `capabilities` (currently just `["test"]`,
  `Dreamers.Agent.Core/Worker/WorkerCapabilities.cs`) on every
  heartbeat; server derives GPU slots from the already-cached `gpus[]`
  metrics (no new storage) via `GET /api/workers`
  (`server/src/job/workers.ts`).
- P3-3: `server/src/job/scheduler.ts` — FIFO, capability + GPU-slot
  matched assignment (`QUEUED` → `ASSIGNED`, sets `worker_id`/
  `gpu_slot`). Runs after every `POST /api/jobs` and on every Agent
  heartbeat. No priority ordering or dependency graph yet (P3-6).
- P3-4: an `ASSIGNED` job rides the Agent's next heartbeat response
  (`ASSIGNED` → `RUNNING`, same "no inbound listener" pattern as
  P2-8's commands). Agent's `TestJobRunner`
  (`Dreamers.Agent.Core/Jobs/`) runs the built-in `test` type —
  sleeps `input.seconds` (default 5), reporting progress 0-100 on
  every heartbeat — then POSTs `/api/agent/job-result`
  (`RUNNING` → `COMPLETED`/`FAILED`). **Deliberate simplification**:
  the Agent only runs one job at a time even on a multi-GPU
  workstation with multiple free slots — true concurrent multi-slot
  execution is deferred, not part of "prove the loop works." All
  worker-scoped job mutations (progress update, complete) verify the
  reporting Agent's own `workstationId` owns the job, mirroring P2-8's
  `recordCommandResult` scoping — a compromised Agent credential can't
  touch another workstation's job.

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
- **Deprecated Docker containers deleted**: `vncgi-remote` and
  `vncgi-remote-93` stopped and removed in Dockge by the user
  2026-08-16. Only `vncgi-remote-server`/`vncgi-remote-web` remain.
- **Phase 3, P3-0 (docs)**: ROADMAP.md milestone breakdown (P3-0
  through P3-8), ARCHITECTURE.md design section.
- **Phase 3, P3-1 (job data model)**: `jobs` table (see
  [db.ts](../server/src/database/db.ts)); `server/src/job/{types,
  validation,repository}.ts`; `server/src/api/jobs.ts` (list/get/
  create/cancel, mounted at `/api/jobs` behind `requireAuth`). No
  scheduler yet — jobs stay `QUEUED` after creation.
- **Phase 3, P3-2 (worker capability + GPU slot reporting)**: Agent
  heartbeat gains `capabilities` (`WorkerCapabilities.cs`, currently
  `["test"]` only); server derives `GET /api/workers`
  (`server/src/job/workers.ts`) from already-cached heartbeat data —
  one entry per agent-paired workstation with its capabilities and one
  GPU-slot entry per reported GPU. No new DB storage.
- **Phase 3, P3-3 (basic scheduler)**: `server/src/job/scheduler.ts` —
  FIFO, capability + GPU-slot matched assignment. Triggered after job
  creation and on every heartbeat (`server/src/api/{jobs,agent}.ts`).
- **Phase 3, P3-4 (job execution on the Agent)**: full loop works
  end-to-end (create → schedule → deliver → run → report). Agent side:
  `TestJobRunner` + `POST /api/agent/job-result`. Server side: job
  delivery/progress/completion wired into the heartbeat handler,
  worker-scoped so one Agent can't touch another's job.

## In Progress

Nothing — P3-1 through P3-4 finished this session. Next up is P3-5 (see
Current Milestone).

Phase 2's two deferred items (P2-8, multi-monitor) were tested live and
found broken; user chose to defer debugging them rather than block on
them (see Known Issues) — not being worked on right now.

## Known Issues

- **P2-8 Restart/Shutdown: live-tested, confirmed NOT working
  ("không có tác dụng").** Deprioritized by the user 2026-08-16 — fix
  later, not now. Root cause not yet diagnosed. Most likely suspect:
  the workstation tested may still have been running the pre-P2-8
  Agent build (an old heartbeat handler would silently ignore an
  unrecognized `command` field in the response rather than error) —
  unconfirmed which workstation was tested or whether that workstation
  had actually received the new single-file `DreamersAgent.exe`. When
  picked back up: confirm the target workstation's Agent version first
  (dashboard shows `agentVersion`), then re-trace
  queue → heartbeat delivery → Agent parse → execute → command-result.
- **Multi-monitor on CGI-DUC: live-tested, confirmed NOT working
  ("không có tác dụng").** Deprioritized by the user 2026-08-16 — fix
  later, not now. Root cause not yet diagnosed — specifically unknown
  whether FIT TO SCREEN now shows both monitors (i.e. whether the
  earlier UltraVNC "System HookDll" unchecking actually fixed capture)
  or whether that's still broken, which would explain why the
  client-side SCROLL TO PAN mode has nothing extra to scroll to. When
  picked back up: start by answering that one diagnostic question
  before touching any code again.
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
- **`192.168.1.3` unexplained** in `vncgi-remote-93`'s old access log (2
  hits, timeout + 404, before that container was deleted) — a subnet
  outside the known studio LAN range, never identified. Worth watching
  for if it resurfaces elsewhere.

## Next Task

**P3-5 — Job lifecycle.** Cancel is already partially there
(`POST /api/jobs/:id/cancel`, P3-1) but doesn't yet stop an actually
RUNNING job on the Agent (it only flips DB status — the Agent has no
way to know a job it's mid-running got cancelled). Add: retry (using
`retry_count`, re-queue a FAILED job up to some limit), real
cancellation the Agent can observe, failure handling polish. Pause/
resume only if it can be done cleanly for the trivial `test` type,
otherwise defer to whichever Phase 4/5 job type first needs it. See
[ROADMAP.md](ROADMAP.md#phase-3--dreamers-job-engine) for the full
P3-0 through P3-8 breakdown.

P2-8 and multi-monitor debugging remain deferred (see Known Issues) —
not blocking Phase 3, pick up whenever the user asks.

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
  already-installed machine.
- **P3-1 job repository**: `npm run typecheck`/`test`/`build` all
  clean (36/36 unit tests, up from 31 — added `job/validation.test.ts`).
  Also ran a throwaway smoke-test script (not committed) exercising
  `createJob`/`getJob`/`listJobs`/`cancelJob` against a real temp
  SQLite file — confirmed the actual SQL round-trips correctly
  (defaults, cancel-twice-is-a-no-op, missing-id returns `undefined`),
  not just that it typechecks.
- **P3-2 worker/GPU-slot reporting**: `dotnet build`/`test` clean
  (35/35, Agent side); server `typecheck`/`test`/`build` clean. Ran a
  second throwaway smoke-test script exercising `listWorkers()` against
  a real temp SQLite DB + populated metrics cache — confirmed an
  agent-less workstation is correctly excluded, a 2-GPU workstation
  correctly produces 2 independent slot entries, and capabilities pass
  through unchanged.
- **P3-3 scheduler**: `findAssignment`/`workerUnits` unit-tested (pure,
  no DB — `job/scheduler.test.ts`). `runScheduler()` itself smoke-tested
  end-to-end (not committed): 1 GPU slot, 2 same-capability jobs + 1
  wrong-capability job → first job `ASSIGNED` to the right worker/slot,
  second stays `QUEUED` (slot taken), third stays `QUEUED` (capability
  mismatch); re-running the scheduler is idempotent (doesn't reassign
  or double-book). typecheck/test/build clean (42/42 unit tests, up
  from 36).
- **Local-dev-only flakiness noticed and worked around**: while
  iterating on `scheduler.test.ts`, hit an intermittent native crash on
  process exit (`RemoveEnvironmentCleanupHook` assertion inside
  `better-sqlite3`'s native addon) — reproduced inconsistently, not on
  every run. Likely related to this being Node v24 (very new) with
  `better-sqlite3` compiled from source rather than an official
  prebuilt binary (see the Node.js install note above). Consolidated a
  redundant second `import ... from "better-sqlite3"` in
  `workstation/repository.ts` into one shared import via `db.ts`
  (harmless either way, ESM+native-addon double-import is one
  documented cause of this class of crash) — 5 clean full-suite runs
  since. **This is a local Windows dev-machine quirk only**: the
  production Docker image builds/runs on `node:20-alpine` (see
  `docker/server.Dockerfile`), a completely different, stable
  environment never exposed to this. If it recurs, it's almost
  certainly not a real application bug — don't chase it as one.
- **P3-4 job execution loop**: `dotnet build`/`test` clean (39/39, up
  from 35 — added `TestJobRunnerTests.cs`, including an actual
  1-second async run verifying progress reaches 100 and the busy/reset
  lifecycle behaves). Server `typecheck`/`test`/`build` clean. Ran a
  third throwaway smoke-test script exercising the full loop against a
  real temp SQLite DB: create → `runScheduler()` assigns → simulated
  heartbeat delivery starts it (`ASSIGNED`→`RUNNING`, `started_at`
  set) → a second delivery attempt correctly finds nothing (no longer
  `ASSIGNED`) → progress update from the *wrong* `workerId` is
  silently ignored, from the *right* one applies → `completeJob` from
  the wrong `workerId` is a no-op, from the right one sets
  `COMPLETED`/progress 100/`finished_at` → a second job created
  afterward gets scheduled onto the now-free worker. All correct.
- **Not yet tested through the live HTTP API or a browser**: `/api/jobs`,
  `/api/workers`, or any Phase 3 endpoint. All verification so far is
  local (unit tests + smoke scripts against a temp DB), not against the
  deployed server.

## Required User Action

Nothing blocking right now — all pending commits are pushed, deployed,
and the 2 deprecated containers are deleted. Remaining items are all
deferred by the user's own choice, to pick up whenever:

- Decide when to resume debugging P2-8 Restart/Shutdown and/or the
  CGI-DUC multi-monitor issue (see Known Issues).
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

**DEPRECATED — removed**
- `vncgi-remote` and `vncgi-remote-93` — M1-era standalone `novnc`
  proxies (hardcoded to CGI-01 port 6080 and COMP-01 port 6081), both a
  real security gap while running (reachable with no dashboard login).
  User confirmed 2026-08-16 the traffic was their own testing, then
  stopped and deleted both in Dockge same day. Repo-side cleanup
  (Dockerfile, compose service, CI build target, docs) done earlier the
  same session. Nothing left running or in the repo. Kept in this list
  as a record, not an open item. See "Known Issues" for the one
  unexplained `192.168.1.3` log entry from `vncgi-remote-93`'s history.

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
