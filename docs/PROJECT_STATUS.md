# Project Status

Last updated: 2026-08-16 (Phase 3 complete; Phase 4 started, P4-0 docs done, blocked on open questions below)

> Handoff snapshot, not a changelog. Detailed history (what changed,
> why, what broke and how it got fixed) lives in `git log` — each
> milestone has one commit with a full message. Read recent commits for
> the story behind a decision, not this file. Long-term direction lives
> in [MASTER_PROJECT_SPEC.md](MASTER_PROJECT_SPEC.md); this file is
> current state only.

## Current Phase

**Phase 4 — Processing (FFmpeg + Topaz).** Started 2026-08-16 (explicit
user request, after Phase 3 finished same day). Phase 1 (Web Remote),
Phase 2 (Dreamers Agent), and Phase 3 (Dreamers Job Engine) are all
complete and in daily/live use; Phase 2 has one known deferred issue
(P2-8 Restart/Shutdown doesn't work on real hardware yet — see Known
Issues). Milestone breakdown for Phase 4 is in
[ROADMAP.md](ROADMAP.md#phase-4--processing-ffmpeg--topaz) (P4-0
onward) — **provisional past P4-1**, real work is blocked on open
architecture questions the spec doesn't answer (see "Info still needed
from user" below). **Nothing from Phase 5 onward is started.**

## Current Milestone

**P4-0 (docs) done.** P4-1 onward is blocked on open questions — see
"Info still needed from user." Phase 3 (P3-1 through P3-8) is fully
complete: the full job engine loop works end-to-end (priority-ordered,
dependency-aware, threshold-gated, software-version-aware scheduling;
real cancellation; retry; stale-job cleanup), has a working dashboard
UI, and has been verified live on real production hardware, not just
locally:
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
- P3-5: **real** cancellation — `POST /api/jobs/:id/cancel` on a
  RUNNING job is now observed by the Agent (the next heartbeat's
  response tells it to stop, via `cancelJobId`), not just a DB status
  flip the Agent never finds out about. `POST /api/jobs/:id/retry`
  (FAILED → QUEUED, bumps `retry_count`, no hard-coded max attempts —
  each retry is a deliberate action, not automatic). Stale-job
  cleanup: a RUNNING job whose worker goes offline (Agent crash, power
  loss, network drop) gets marked FAILED with an explanatory error
  instead of sitting RUNNING forever and permanently occupying its
  slot — checked on every scheduler run via `failStaleRunningJobs()`.
- P3-6: priority-ordered scheduling (`jobs.priority`, was already a
  column since P3-1 but ignored until now — `ORDER BY priority DESC,
  id ASC`); `workstations.jobs_enabled` (manual admin on/off switch
  for job assignment — distinct from `enabled`, which gates monitoring/
  probing); hardcoded CPU/RAM/GPU usage thresholds (90% — see
  `CPU_THRESHOLD_PERCENT` etc. in `scheduler.ts`) gating new
  assignment; basic single-dependency (`jobs.depends_on` — a job won't
  be scheduled until its dependency is `COMPLETED`). **Deliberate
  simplification**: MASTER_PROJECT_SPEC.md §11's full 5-state model
  (`AVAILABLE`/`BUSY`/`DISABLED`/`DEDICATED_WORKER`/`INTERACTIVE`) is
  collapsed to just the `jobs_enabled` boolean + thresholds for now —
  `BUSY` is derived at query time (free-unit check), not stored;
  `DEDICATED_WORKER`/`INTERACTIVE` as distinct states are deferred
  until a concrete workflow needs to tell them apart from plain
  disabled. Thresholds are hardcoded, not yet admin-configurable (that
  needs a real settings UI — Phase 6/7 territory).
- P3-7: Jobs dashboard page (`web/src/pages/JobsPage.tsx`, linked from
  the main dashboard header). Polls `GET /api/jobs` every 3s, shows
  id/type/status pill/priority/depends_on/retry_count/progress bar/
  assigned worker+GPU slot/error per job, a "+ TEST JOB (10s)" button
  (`POST /api/jobs` with `type:"test"`), cancel button on QUEUED/
  ASSIGNED/RUNNING jobs, retry button on FAILED jobs. Also fixed a real
  bug found only by browser-testing this: Vite's dev-server dependency
  pre-bundling step has its own `esbuild` target separate from
  `build.target`, so `@novnc/novnc`'s top-level await (already worked
  around for production builds) still broke `npm run dev` — fixed by
  also setting `optimizeDeps.esbuildOptions.target: "esnext"` in
  `vite.config.ts`.
- P3-8: software version compatibility, **mechanism only** (per
  MASTER_PROJECT_SPEC.md §16) — no real software checks exist yet
  (nothing to check until Phase 4/5 installs real tools). Agent reports
  `software_versions` (wire name `softwareVersions`, camelCase — see
  note below) on every heartbeat, currently a fixed
  `{"test":"1.0.0"}` placeholder
  (`Dreamers.Agent.Core/Worker/WorkerSoftwareVersions.cs`, mirrors
  `WorkerCapabilities`'s "test" placeholder). A job can optionally
  carry `required_software` (`{name: version}`, exact-match only, no
  semver range comparison); the scheduler
  (`softwareRequirementsSatisfied` in `job/scheduler.ts`) won't assign
  it to a worker that doesn't report a matching version, same
  incompatible-worker-skipped behavior as a missing `capability`.
  Stored as a new `jobs.required_software` TEXT column (JSON string,
  null = no requirement — same convention as `depends_on`). **Real bug
  caught while wiring this up**: the Agent's heartbeat payload is
  actually camelCase throughout (`agentVersion`, `runningJob`, ...),
  not the snake_case the rest of this API uses — `ServerClient.cs` sets
  `PropertyNamingPolicy = JsonNamingPolicy.CamelCase`. First pass named
  the new TS-side field `software_versions` (matching the DB column,
  wrong for this payload) and it would have silently never matched the
  Agent's actual `softwareVersions` JSON key; caught before committing
  by re-reading the existing `AgentMetricsPayload` fields rather than
  assuming the general snake_case convention applied here too.

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
- **Phase 3, P3-5 (job lifecycle)**: real cancellation the Agent
  observes (`TestJobRunner.Cancel`, `cancelJobId` in the heartbeat
  response), `POST /api/jobs/:id/retry`, stale-RUNNING-job cleanup
  (`failStaleRunningJobs`, called every scheduler run).
- **Phase 3, P3-6 (priority + availability + dependency)**: priority-
  ordered scheduling, `workstations.jobs_enabled` admin switch,
  hardcoded CPU/RAM/GPU thresholds, basic single-job dependency
  (`jobs.depends_on`).
- **Phase 3, P3-7 (Jobs dashboard page)**: full queue view, test-job
  creation, cancel, retry — verified end-to-end both locally in a
  browser and live on production against real Agent-run hardware (see
  Tests Performed). Found and fixed a real bug along the way: the
  Agent's double-click self-update (`UpdateInPlaceAsync` in
  `agent/Dreamers.Agent/Program.cs`) could lose a race between the
  Windows Service Control Manager reporting `STOPPED` and the old
  process actually releasing its exe file handle, causing the update
  to silently fail and roll back to the old binary — fixed with a
  short retry loop around the file copy.
- **Phase 3, P3-8 (software version compatibility, mechanism only)**:
  `jobs.required_software` column, `softwareRequirementsSatisfied` in
  the scheduler, Agent's `WorkerSoftwareVersions` placeholder. See
  Current Milestone for detail, including the camelCase-vs-snake_case
  bug caught before it shipped.

**Phase 3 is now fully complete (P3-0 through P3-8).**

## In Progress

Nothing — Phase 3 (P3-0 through P3-8) finished this session. Waiting
on the user for what's next.

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

**P4-1 — FFmpeg capability + real capability detection**, blocked on
the user answering the open questions below (file-access architecture
mainly — P4-1 itself doesn't strictly need them, but there's no point
detecting FFmpeg capability without knowing what P4-2 will need to run
it against). See [ROADMAP.md](ROADMAP.md#phase-4--processing-ffmpeg--topaz)
for the full P4-0 through P4-5 breakdown (provisional past P4-1).

All 4 workstations' Agents are now updated and reporting both
`capabilities` (P3-2) and `softwareVersions` (P3-8) correctly —
verified live via `/api/workers` 2026-08-16. Rollout item from earlier
is done.

P2-8 and multi-monitor debugging remain deferred (see Known Issues) —
not blocking, pick up whenever the user asks.

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
- **P3-5 job lifecycle**: `dotnet build`/`test` clean (42/42, up from
  39 — added 3 `Cancel()` tests including a real cancelled-mid-sleep
  run). Server `typecheck`/`test`/`build` clean. A fourth throwaway
  smoke-test script confirmed: retry is a no-op on a non-FAILED job,
  succeeds from FAILED (bumps `retry_count`, clears result fields, gets
  re-scheduled); `isJobStillRunning` correctly flips false the instant
  an admin cancels a RUNNING job (and is workerId-scoped); a RUNNING
  job whose worker's `last_seen` goes stale gets marked FAILED with an
  explanatory error, and the worker becomes assignable again once back
  online.
- **P3-6 priority/availability/dependency**: typecheck/test/build
  clean (43/43 unit tests). A fifth throwaway smoke-test script (with a
  real bug of its own caught and fixed along the way — see below)
  confirmed: a higher-priority job is assigned before an older
  lower-priority one when only one unit is free; `jobs_enabled: false`
  blocks new assignment to that worker; CPU-over-threshold blocks it
  too; a GPU pinned above threshold on one worker correctly gets
  skipped in favor of a free CPU-only unit on a different worker; a
  dependent job stays `QUEUED` until its dependency is `COMPLETED`,
  then gets scheduled. **Process note**: the smoke test's first version
  had a wrong expectation, not the code — it assumed a freshly-freed
  slot would go to the job it was testing, without accounting for older
  still-`QUEUED` jobs from earlier scenarios in the same script (lower
  id, same priority) legitimately winning that slot first under
  `runScheduler()`'s real FIFO-among-equal-priority behavior. Fixed by
  isolating each scenario's state rather than changing the scheduler.
  Also hit the same known intermittent local-dev-only native crash
  (see the Node.js entry above) once during this milestone — 3
  subsequent clean full-suite runs confirmed it wasn't a regression.
- **P3-7 Jobs dashboard — full local browser verification** (first
  time this session testing a UI in an actual browser, not just
  typecheck/build): ran the compiled server (`node dist/index.js` —
  avoids the intermittent native crash below more reliably than `tsx`)
  against a throwaway local SQLite file, and the web app via
  `npm run dev`, both stopped and cleaned up afterward (temp DB
  deleted, not committed). Logged in, opened `/jobs`: empty state
  renders correctly, "+ TEST JOB (10s)" creates a job that appears
  immediately as `QUEUED` with a 0% progress bar and "Chưa gán máy"
  (correct — no live Agent is connected to this local-only test
  backend, so it never gets past `QUEUED`), cancel button flips it to
  `CANCELLED` and correctly removes the action buttons, back-link to
  the dashboard works. Console/network errors present in the log were
  all confirmed stale (pre-login 401s, pre-fix connection-refused
  entries), not live issues. Caught and fixed one real bug this way
  (see P3-7 entry under Current Milestone) that no amount of
  typecheck/build/unit-testing would have surfaced, since it only
  breaks `vite dev`, not `vite build`.
- **P3-7 — full live verification against production, real hardware,
  real Agent** (same session, after the local browser pass above): the
  user tested the deployed dashboard directly and hit a real dead end —
  every job stayed `QUEUED` / "Chưa gán máy" forever. Root-caused via
  `curl`'d `GET /api/workers` against the live server
  (`http://192.29.11.92:8080`, session-cookie auth) rather than asking
  the user to fetch/paste it: all 4 workstations reported
  `"capabilities":[]`. Confirmed `vncgi-remote-server` itself *was*
  already up to date (its `/api/workers` response already had the
  P3-2/P3-6 shape), so the gap was purely Agent-side — none of the 4
  workstations had ever had the Agent binary redeployed since P3-2
  added capability reporting, since Agent updates are a manual
  double-click per machine (`agent/README.md`), not something CI/CD
  touches.
  - Built a fresh `DreamersAgent.exe` and had the user double-click it
    on `CGI-Render` (this dev machine also doubles as a studio
    workstation) to update in place. First attempt failed with a real
    bug, caught from the installer's own console output: `sc stop`
    reports `STOPPED` to the Service Control Manager a moment before
    the underlying .NET process has actually exited and released its
    file handle, so the immediately-following `File.Copy` in
    `UpdateInPlaceAsync` (`agent/Dreamers.Agent/Program.cs`) hit
    "The process cannot access the file ... being used by another
    process" and rolled back to the old binary rather than updating —
    this is exactly the "double-click installer flow on a real
    already-installed machine" scenario flagged as untested in earlier
    entries here, and it turned out to have a genuine bug once
    actually tried. **Fix**: wrap the copy in `CopyWithRetryAsync`
    (up to 10 attempts, 500ms apart) to absorb that race instead of
    failing outright — `dotnet build`/`test` clean (still 42/42,
    Program.cs's install flow has no direct unit coverage, it's the
    interactive entry point). Rebuilt, the user re-ran the updated
    installer, and this time verified live: `CGI-Render`'s
    `/api/workers` entry flipped to `"capabilities":["test"]`.
  - Created a real job directly via `curl` (`POST /api/jobs`,
    `{"type":"test","input":"{\"seconds\":8}"}`) against production and
    polled `GET /api/jobs/8` myself: `QUEUED` → `ASSIGNED` (worker 3 /
    CGI-Render, gpu_slot 1, immediately) → `RUNNING` (progress ticking,
    62% mid-poll) → `COMPLETED` (progress 100, `finished_at` set) —
    **the full job engine loop confirmed working end-to-end on real
    production hardware**, not just local unit tests/smoke
    scripts/local-dev browser testing. This is the first real
    confirmation of the whole Phase 3 loop outside a dev machine.
  - **Not yet updated**: `CGI-01`, `COMP-01`, `CGI-DUC` still report
    `capabilities:[]` — same Agent redeploy needed on each,
    user's/team's call on when. Not blocking; the loop itself is now
    proven, this is just rollout remaining on 3 more machines.
- **P3-8 software version compatibility**: `npm run typecheck`/
  `test`/`build` clean (52/52 unit tests, up from 43 — added 6
  `scheduler.test.ts` cases for `softwareRequirementsSatisfied`/
  `findAssignment` and 3 `validation.test.ts` cases for
  `required_software`). `dotnet build`/`test` clean (42/42, no new
  Agent-side tests — `WorkerSoftwareVersions` is a static placeholder
  mirroring `WorkerCapabilities`, which also has none). A sixth
  throwaway smoke-test script (not committed) against a real temp
  SQLite DB confirmed the full mechanism: a job requiring
  `{"test":"1.0.0"}` stays `QUEUED` against a worker reporting
  `"test":"0.9.0"`; bumping the worker's reported version to match gets
  it `ASSIGNED` on the next scheduler run; a job with no
  `required_software` is unaffected by version at all. **Process
  note**: the smoke test's first version had a wrong expectation, not
  the code — it seeded `workstations.last_seen` via SQLite's
  `datetime('now')`, which returns a space-separated string without a
  timezone marker; JS's `Date` parses that as local time, not UTC,
  silently breaking `isAgentOnline`'s freshness check. Production code
  never has this problem (it always writes `last_seen` via
  `new Date().toISOString()`, not raw SQL) — fixed the test to match,
  not the app.

## Required User Action

Nothing blocking right now — all pending commits are pushed, deployed,
and the 2 deprecated containers are deleted. Remaining items are all
deferred by the user's own choice, to pick up whenever:

- Decide when to resume debugging P2-8 Restart/Shutdown and/or the
  CGI-DUC multi-monitor issue (see Known Issues).
- Eventually: change the admin password; decide on CPU temperature.
- Optional: double-click-update the Agent on `CGI-01`, `COMP-01`,
  `CGI-DUC` (same as already done on `CGI-Render`) whenever they need
  to actually run jobs — not urgent, the job engine itself is proven
  working.
- Decide what's next now that Phase 3 is complete (Phase 4 FFmpeg
  processing per the roadmap, or something else) — not started per the
  "don't start a future phase without an explicit request" rule.

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
- **Phase 4 blockers, added 2026-08-16** — MASTER_PROJECT_SPEC.md §17
  says "User Upload → TrueNAS Storage → PHP creates Job → Dreamers Job
  Queue → Windows Worker → FFmpeg NVENC → Result → TrueNAS" but this
  repo has no visibility into the PHP/upload side of that flow:
  - **What creates the job?** Is there already a PHP app on TrueNAS
    that will call `POST /api/jobs`, or does that not exist yet either
    (i.e. is building it part of Phase 4's scope too)? If it exists:
    where does it live, what auth would it use to call our API (the
    session-cookie auth `/api/jobs` currently requires assumes a
    logged-in dashboard user, not a server-to-server caller)?
  - **How does a Windows worker reach the source file and write the
    result?** SMB share from TrueNAS mounted on each of the 4
    workstations? If so, what's the mount point / UNC path convention,
    and does it already exist or does Phase 4 need to set it up? This
    blocks P4-2 (the actual FFmpeg job runner) — it can't be written
    without knowing what a job's `input`/`output` paths will look like.
  - **Job input schema** — once file access is answered: what does an
    FFmpeg job actually need to specify (source path, target codec/
    container, resolution, bitrate/quality preset, output path)? Can
    default to something reasonable once the above is answered, but
    worth confirming rather than guessing given it's a new contract.
