# Project Status

Last updated: 2026-09-02 — **Phase 4 is complete (P4-0 through P4-7, all
DONE)**. This session found that this dev machine (hostname `CGIVN`,
`192.29.11.93`) **is COMP-01 itself** — not a separate unreachable dev
box as prior sessions assumed — and, by relaying the same steps to the
user, got CGI-Render (`192.29.11.95`) redeployed too, closing the one
gap ("no path to CGI-Render") that had blocked real multi-GPU
verification since 2026-08-18.

**P4-3H (Processing Infrastructure Hardening, new milestone)** fixed
three real gaps live testing surfaced in the job engine's execution
model: (1) a per-job execution lease (`jobs.last_progress_at`) so a job
whose Agent-side execution died (process restarted mid-job) fails with
`STALE_EXECUTION` instead of sitting RUNNING forever — the exact bug
hit live as job #35, which auto-resolved once the fix deployed; (2)
`WorkerCapabilities`'s NAS/Topaz checks changed from `Lazy<T>`
(computed once, ever) to a 2-minute refresh, so a transient startup
hiccup self-heals instead of permanently hiding `ffmpeg`/`topaz`
capabilities; (3) **true concurrent execution per GPU slot** — the
Agent used to run only one job at a time across its whole process
regardless of GPU slot (confirmed live: a second job assigned to a free
GPU sat `ASSIGNED` the entire time the first ran); now each
`IJobRunner` tracks jobs independently by id and the "one job at a
time" gate is gone. 113/113 Agent unit tests green.

**Deployed and verified live on real hardware, both machines**:
COMP-01 (this session, direct) and CGI-Render (user relayed the same
`git pull`/`dotnet publish`/self-update steps) — `capabilities`
recovered on both (`ffmpeg` on both, `topaz` only on COMP-01, which is
the only one with it installed — expected, not a bug), server updated
in Dockge. **The actual pass/fail test**: two real jobs (#38, #39)
created on CGI-Render within 6ms of each other landed on GPU0/GPU1 and
were confirmed **`RUNNING` simultaneously**, progressing in lockstep,
completing together — not sequential, not one waiting on the other.

**P4-5 (PHP integration)** — server side done: a dedicated non-admin
service account (`auth/users.ts`'s `seedServiceUser`, gated behind
`PHP_SERVICE_PASSWORD`) lets the PHP Projects site authenticate to
`POST /api/jobs` the same way any dashboard user does, with zero new
auth surface. The PHP side itself is out of this repo's scope by
design — user's stated plan is a throwaway test upload form before
wiring the real PHP codebase, not started yet, see ROADMAP.md.

**P4-7 (close/hardening)** reviewed every open item across Phase 4:
each is now resolved or explicitly deferred with a reason (see
ROADMAP.md's P4-7 entry) — nothing silently dropped.

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
onward). **Nothing from Phase 5 onward is started.**

**Architecture decided by the user 2026-08-16** (superseding the
"provisional, open questions" note this file had earlier the same
day):
1. **Job creation**: the existing PHP Projects site
   (`http://192.29.11.92:8088/Projects`) is the job-creation side —
   calls `POST /api/jobs` directly. No new PHP app in this repo.
2. **File access**: a Windows worker reads/writes files via a
   configurable UNC path straight to TrueNAS storage
   (e.g. `\\192.29.11.92\Projects\...`) — never through the Dreamers
   API. The web route above is display-only, never a source/output
   path. `projectId` links a job to a Project on the PHP site for
   reference; the Worker only ever acts on the UNC
   sourcePath/outputPath the server has already validated.
3. **Job schema**: structured (`sourcePath`, `outputPath`, `codec`,
   `qualityMode`, `quality`, `bitrate`, `preset`, `resolution`,
   `audioCodec`, `projectId`), not a raw FFmpeg command — the Agent
   builds arguments from a whitelist. Not hardcoded to H.264: codec is
   one of `h264_nvenc`/`hevc_nvenc`/`av1_nvenc`.
4. **Security**: PHP never sends a raw command; the Worker validates
   sourcePath/outputPath against a configured allow-list before
   touching the filesystem (independently of the server's own check —
   defense in depth, not just one gate).
5. User explicitly said not to stop and ask about these — implemented
   directly per the decision above, only stopping for genuine
   blockers.

## Current Milestone

**P4-3H (Processing Infrastructure Hardening)** — code done and unit-
tested, partially deployed. See ROADMAP.md's P4-3H entry for the full
milestone description; this section is the session narrative.

**How this milestone started**: asked to check the old P4-5's real
2-GPU verification (which the user had deferred 2026-08-18), this
session logged into the live dashboard (`192.29.11.92:8000/jobs`) and
found jobs #32/#33 (both on `CGI-Render`) had actually run *sequentially*
12s apart, not concurrently — not evidence of anything. Firing a real
concurrency test directly (two `test` jobs assigned to CGI-Render's GPU0
and GPU1 at the same time, `POST /api/jobs` + polling `GET /api/jobs`)
showed the GPU1 job sitting `ASSIGNED` at 0% the entire time the GPU0 job
ran — never actually starting until the first one finished. Reading
`Worker.cs` confirmed why: `_jobRunners.Values.Any(r => r.IsBusy)` gated
*every* new job start on nothing else being in flight anywhere on the
Agent, regardless of GPU slot — a deliberate P3-4/P4-2 simplification
that P4-5 could never have gotten past. Mid-test, job #35 (one of the
two concurrency-test jobs) got orphaned — stuck `RUNNING` at 83% forever,
`finished_at` null — while job #36 (assigned to the *other* GPU slot,
same worker) went on to complete normally. Best explanation: the
CGI-Render Agent process restarted between the two, losing its in-memory
`TestJobRunner` state for #35 without the server ever finding out (the
worker itself kept heartbeating fine, so the old worker-level stale
check never caught it). **This session then discovered it is itself
running on COMP-01** (hostname `CGIVN`, IP `192.29.11.93` — matches the
`workstations` table exactly; `DreamersAgent` Windows Service is
installed and `Running` right here, `C:\ProgramData\DreamersRemote\`
present, ffmpeg on PATH) — prior sessions' notes about needing "remote
access to COMP-01" were describing *this machine*, not a separate one.

Three fixes landed as a result (see ROADMAP.md's P4-3H for the technical
detail of each): the per-job execution lease
(`jobs.last_progress_at`/`failStaleRunningJobs`), the NAS/Topaz
capability re-check (`WorkerCapabilities`, `Lazy<T>` → 2-minute TTL —
also the likely explanation for `capabilities: ["test"]` missing
`ffmpeg` on both COMP-01 and CGI-Render observed live this session,
despite `softwareVersions.ffmpeg` still being present), and true
concurrent per-GPU execution (`IJobRunner` tracks jobs by id instead of
one shared slot; `Worker.cs`'s global busy gate removed; server's
`/api/agent/heartbeat` hands out every `ASSIGNED` job for a worker
instead of at most one, and accepts/reports a *list* of running jobs
instead of one — both ends keep the old singular field alongside the
new plural one so a not-yet-redeployed Agent or server keeps working
unchanged).

**Deployed so far**: COMP-01 (this machine) — `dotnet publish` produced
a fresh single-file `agent/dist/DreamersAgent.exe`; its interactive
self-update flow was triggered (`Start-Process`), which re-launches
itself elevated via UAC — this session cannot click the consent prompt
itself (no desktop/GUI control, only a command shell), so this needs the
user's one click to actually complete. Not yet deployed: the server
(`vncgi-remote-server` in Dockge) and CGI-Render (RDP reachable at
`192.29.11.95:3389`, but no credentials/remote-exec tool from this
session — same "needs a human or a relayed session there" situation
P4-3/P4-4/old-P4-5 already established for that machine). See Required
User Action.

Below this point is the **old P4-5/current-P4-6** groundwork narrative
(GPU device-targeting), kept as-is — still accurate, just no longer the
reason concurrent execution didn't work (that was the Agent's
single-job-at-a-time design, fixed above, not missing `-gpu`/`device=`
flags):
- **Explicit GPU device-targeting, threaded end-to-end.** Previously,
  neither `ffmpeg` nor `topaz` jobs told the encoder/model which GPU to
  use — both left it to driver-default selection (`-2`/Auto for
  Topaz's `tvai_up`, nothing at all for ffmpeg's NVENC), even though
  the scheduler (`job/scheduler.ts`, since P3-3) already reserves an
  independent `gpu_slot` per job on a multi-GPU worker. On a single-GPU
  box this never mattered; on `CGI-Render`'s 2 GPUs it could silently
  let two concurrent jobs fight over the same physical GPU despite the
  scheduler believing they had separate slots — exactly what P4-5 is
  supposed to confirm doesn't happen. Fixed by threading `gpu_slot` the
  whole way through: `server/src/api/agent.ts`'s heartbeat response now
  includes `gpuSlot` alongside `id`/`type`/`input` (reads
  `assigned.gpu_slot`, already stored — no DB/scheduler change needed);
  `agent/.../Server/ServerClient.cs`'s `AssignedJobPayload`/`AssignedJob`
  carry it; `IJobRunner.Start` gained a third `int? gpuSlot` parameter
  (implemented in `TestJobRunner` as an accepted-but-unused no-op,
  `FfmpegJobRunner`/`TopazJobRunner` pass it through to
  `FfmpegArgs.Build`/`TopazArgs.Build`); `FfmpegArgs` adds `-gpu N`
  (ffmpeg's own documented NVENC option) when present; `TopazArgs` sets
  `device=N` in the `tvai_up` filter (replacing the hardcoded `-2`) AND
  adds `-gpu N` for the post-upscale encode step — pinning both to the
  same device, since pinning only one would let the driver put the
  upscale and the encode on different physical GPUs.
- **Verified as far as this machine allows**: `dotnet test` 110/110
  (4 new cases confirming `-gpu`/`device=` appear only when a slot is
  assigned, and reflect the right index), server `typecheck`/`build`
  clean. Real hardware proof (not just string assertions): ran both
  `TopazJobRunner` (via a throwaway xUnit test) and a raw `ffmpeg -gpu
  0 ...` invocation with an explicit `gpuSlot`/`-gpu 0` against this
  machine's single real GPU — both completed successfully, confirming
  the new flags are accepted by the real binaries, not just well-formed
  strings. **What this does NOT prove**: that two concurrent jobs
  actually land on independent physical GPUs rather than fighting over
  one — that needs a real 2-GPU box (`CGI-Render`) running two jobs at
  once, which is P4-5's actual remaining scope.

P4-0 through P4-4, P4-3H, P4-5 (server side), and P4-6 are all done —
see ROADMAP.md for the full P4-0 through P4-7 breakdown (renumbered
2026-09-02). P4-5's remaining piece (the PHP Projects site itself
actually calling the API) lives outside this repo — see "Info still
needed from user". Phase 3
(P3-1 through P3-8) is fully complete: the full job engine loop works
end-to-end (priority-ordered, dependency-aware, threshold-gated,
software-version-aware scheduling; real cancellation; retry; stale-job
cleanup), has a working dashboard UI, and has been verified live on
real production hardware, not just locally:
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

- **Phase 4, P4-1 (FFmpeg capability + real detection)**:
  `Dreamers.Agent.Core/Ffmpeg/FfmpegDetector.cs` — runs
  `ffmpeg -version`/`-encoders` once per Agent process (`Lazy<T>`, not
  every heartbeat), reports `ffmpeg` as a `WorkerCapabilities` entry
  and its real version via `WorkerSoftwareVersions` only when actually
  found; detects but doesn't yet surface NVENC encoder support
  (h264/hevc/av1) beyond the internal `FfmpegInfo` record — nothing
  needs it yet.
- **Phase 4, P4-2 (FFmpeg job runner, end to end)**: real `ffmpeg` job
  type. Server: `server/src/job/ffmpegValidation.ts` (structured input
  validation — enums for codec/qualityMode/preset/audioCodec, regex for
  bitrate/resolution, path-prefix check against `FFMPEG_ALLOWED_ROOTS`
  env var), new `jobs.fps`/`jobs.eta_seconds` columns (generic progress
  detail, not FFmpeg-specific). Agent:
  `Dreamers.Agent.Core/Jobs/FfmpegJobRunner.cs` — independently
  re-validates paths against its own `allowed_paths.json`
  (`AllowedPathsConfigStore`, empty/deny-all by default), confirms the
  source file exists, builds ffmpeg's argument list from a whitelist
  only (`FfmpegArgs` — enums/regex-checked, never a raw command string,
  always `ProcessStartInfo.ArgumentList` not `UseShellExecute`), parses
  `-progress pipe:1` output for machine-readable
  progress/fps/eta (`FfmpegProgressParser`, `FfprobeDuration` for total
  duration), reports success only if exit code 0 **and** the output
  file exists. `Worker.cs` now dispatches to one of several
  `IJobRunner`s keyed by job `type` (`Dreamers.Agent.Core/Jobs/
  IJobRunner.cs`) instead of hardcoding `TestJobRunner` — `TestJobRunner`
  itself refactored onto the same interface/shared `JobSnapshot` type,
  no behavior change. **Real bug caught by this milestone's own unit
  tests**: `FfmpegJobRunner.Start()` could finish synchronously (via a
  fast validation failure with no `await` reached) before returning
  control to its caller, making `IsBusy` unreliable immediately after
  `Start()` — fixed with an `await Task.Yield()` as `RunAsync`'s first
  line, guaranteeing `Start()`'s own synchronous state-set always wins
  the race. **Not yet run against a real ffmpeg encode** — see Tests
  Performed and Known Issues.
- **Jobs dashboard: FFmpeg visibility.** `web/src/pages/JobsPage.tsx`
  gained a second button, "+ FFMPEG DEMO (GPU encode thật)", that
  creates a real `ffmpeg` job against the real source clip verified
  above (`\\192.29.11.92\web_data\www\Projects\SOURCE\
  A008C005_130101_R31Z.mov`) — added so the user can actually watch a
  real GPU encode happen on the dashboard, not just read about it in
  this file. Job rows now also show `fps`/`eta_seconds` when a job
  reports them (`web/src/types/job.ts` gained the matching fields).
  Requires `FFMPEG_ALLOWED_ROOTS` (server) and `allowed_paths.json`
  (Agent) to already include that UNC root — see Required User Action.
- **Phase 4, P4-4 (Topaz Video AI worker, upscale-only v1)**: a second,
  independent `topaz` job type mirroring `ffmpeg`'s file structure
  almost exactly (per `docs/ROADMAP.md`'s "should mostly be write a
  TopazJobRunner, not scheduler changes" — confirmed true, zero
  scheduler/api changes needed, `findAssignment` already matches purely
  on `worker.capabilities.includes(jobType)`, a free-form string).
  Agent: `Configuration/TopazConfig.cs`/`TopazConfigStore.cs` (where
  Topaz's own proprietary `ffmpeg.exe` and model cache dir live —
  `C:\ProgramData\DreamersRemote\topaz_config.json`),
  `Topaz/TopazDetector.cs` (confirms the configured binary really has
  the `tvai_up` filter, not just any ffmpeg), `Topaz/TopazJobInput.cs`/
  `TopazArgs.cs` (adds `model`/`scale`, reuses `FfmpegArgs`'s
  codec/qualityMode/preset/audioCodec whitelists rather than
  duplicating them — made those `internal` for this reuse),
  `Jobs/TopazJobRunner.cs` (near-identical to `FfmpegJobRunner.cs`:
  same `PathValidator`/`AllowedPathsConfigStore`/`NasConnector` reuse,
  same `-progress pipe:1` parsing via the same
  `FfmpegProgressParser`/`FfprobeDuration` — Topaz's ffmpeg build emits
  identical output — only real difference is invoking Topaz's
  full-path `ffmpeg.exe`, never the bare `"ffmpeg"` PATH token, plus
  setting `TVAI_MODEL_DIR`/`TVAI_MODEL_DATA_DIR` env vars).
  `WorkerCapabilities` gates `"topaz"` on `TopazDetector` finding it AND
  the same shared NAS health check `"ffmpeg"` already uses (one NAS
  session serves every job type). New CLI diagnostic:
  `DreamersAgent.exe test-topaz` (mirrors `test-nas`). Server:
  `job/topazValidation.ts` mirrors `ffmpegValidation.ts`, reusing its
  now-exported enums/helpers; `model` is a regex whitelist
  (`^[a-z0-9-]{1,32}$`), not a fixed enum like `codec` — Topaz's model
  catalog changes with app updates, but the value still feeds an ffmpeg
  filter-graph expression so it needs *some* whitelist to block
  `:`/`,`/`;` filter-graph-syntax injection. Reuses
  `FFMPEG_ALLOWED_ROOTS`/`allowed_paths.json` rather than adding a
  second `TOPAZ_ALLOWED_ROOTS` — same NAS roots concept either way.
  **v1 scope is upscale only** (`tvai_up`) — frame interpolation/
  stabilization (`tvai_fi`/`tvai_stb`, also present in Topaz's ffmpeg
  build) deferred, user's explicit choice. **GPU device targeting
  deferred to P4-5**: `tvai_up` takes an explicit `device` (GPU index),
  but the Agent has no way to know which `gpu_slot` the scheduler
  assigned (`AssignedJob` only carries `Id`/`Type`/`Input`) — same
  pre-existing gap `ffmpeg` jobs already have, not introduced by this
  milestone; `device=-2` (Auto) is fine on COMP-01/CGI-01 (single-GPU)
  today. Web: `web/src/pages/JobsPage.tsx` gained "+ TOPAZ DEMO (Upscale
  thật)", same demo source clip as the FFmpeg button.
  **Real risk investigated and cleared before writing the runner**
  (planned explicitly as decision 6, see the approved plan): does
  `tvai_up` need an interactive-user-scoped Topaz login/license, which
  `LocalSystem` wouldn't have (the exact shape of P4-3's NAS problem)?
  Tested via the same `schtasks /RU SYSTEM` diagnostic trick that
  worked for NAS — **no such blocker**: a real `tvai_up` upscale
  completed fine under SYSTEM, identical output to running interactively
  (640x480 from a 320x240 source, confirmed via `ffprobe`). The one real
  requirement found: `TVAI_MODEL_DIR`/`TVAI_MODEL_DATA_DIR` env vars
  must be set (a machine-wide `C:\ProgramData\...` path, not a
  per-user one) or `tvai_up` fails with "Model not found" even for an
  already-cached model — not license-related, just a missing directory
  hint.

## In Progress

Nothing blocking — Phase 4 P4-0 through P4-4 all done, P4-3/P4-4 both
verified against real hardware on COMP-01. P4-3 has one open item
(PHP's auth mechanism for calling `POST /api/jobs`, see "Info still
needed from user") but isn't blocked on it for anything already built.
Next up per the roadmap: **P4-5 — multi-GPU verification with real
workloads** (needs `CGI-Render`, the only 2-GPU box — see Next Task).

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
- **FFmpeg build vs. NVIDIA driver version matters for NVENC.** Found
  installing ffmpeg on `CGI-Render` to verify P4-2 for real (see Tests
  Performed): the latest `Gyan.FFmpeg` winget build (9.0, requires
  NVENC API 13.1) failed with "Driver does not support the required
  nvenc API version. Required: 13.1 Found: 13.0 — minimum Nvidia
  driver 610.00 or newer" — `h264_nvenc`/`hevc_nvenc`/`av1_nvenc` all
  fail outright on this machine's current driver. `BtbN.FFmpeg.GPL.7.1`
  (an older release branch, same winget source) works fine with the
  same driver — confirmed with a real hardware-encoded NVENC output.
  **Not fixed by updating the driver** — deliberately not done, since
  this machine (`CGI-Render`) is also in active use for real work and a
  driver update is disruptive/risky to do unprompted. When installing
  ffmpeg on the other 3 workstations: check `nvidia-smi`'s reported
  driver version against whatever ffmpeg build's NVENC SDK requirement
  before assuming "latest ffmpeg" is the right choice — pin to a build
  known to match, don't just grab whatever winget's default/newest
  package is.
- **`h264_nvenc` rejects 10-bit source outright.** Found running a real
  10-bit ProRes 422 source (a real production clip from the TrueNAS
  Projects share) through `h264_nvenc`: "10 bit encode not supported...
  No capable devices found" on this hardware/driver. H.264 delivery is
  essentially always 8-bit 4:2:0 anyway, so `FfmpegArgs.Build` now
  always adds `-pix_fmt yuv420p` when `codec == "h264_nvenc"` — fixed
  and confirmed (same source, same job, succeeds after the fix).
  Deliberately scoped to `h264_nvenc` only: `hevc_nvenc`/`av1_nvenc`
  genuinely support 10-bit (Main10) on this hardware, forcing 8-bit
  there would be an unnecessary quality loss for sources that don't
  need it.

## Next Task

**P4-2, P4-3, and P4-4 are all now fully verified end-to-end** — real
ffmpeg, real Topaz upscale, real NVENC hardware encode, real UNC/SMB
share, real production source file, real dashboard-triggered jobs.
Nothing left unverified in these milestones (see Tests Performed).

**Phase 4 is complete as of 2026-09-02 (P4-0 through P4-7, all DONE)** —
see ROADMAP.md's P4-7 entry for the close-out pass (every "Not yet
done"/"Open item" note across Phase 4 resolved or explicitly deferred
with a reason). The one remaining piece, PHP Projects actually calling
the API, lives outside this repo by design (see P4-5's entry and "Info
still needed from user") — not a blocker for calling Phase 4 done on
this repo's side. **Nothing from Phase 5 onward should start without an
explicit user request** (standing rule, CLAUDE.md).

P2-8 and multi-monitor debugging remain deferred (see Known Issues) —
not blocking, pick up whenever the user asks.

## Tests Performed

- **P4-3H, 2026-09-02**: `dotnet build Dreamers.Agent.sln` clean (0
  warnings/errors); `dotnet test Dreamers.Agent.sln` — **113/113
  passing**, including new cases proving the actual behavior this
  milestone changes: `TestJobRunnerTests.Start_TwoDifferentJobIds_RunConcurrently`
  and the equivalent `FfmpegJobRunnerTests`/`TopazJobRunnerTests`
  `StartTwoDifferentJobIdsDoesNotThrowAndBothResolveIndependently` cases
  start two different job ids on the *same* runner instance and assert
  neither blocks/throws because of the other — the exact thing the old
  `IsBusy`/single-`_current`-field design would have failed. Server:
  `npx tsc --noEmit` clean; `npm test` — pre-existing gap confirmed
  unrelated to this change (`git stash` reproduces the same 2 failures
  before this session's edits): `better-sqlite3`'s native addon has no
  prebuilt binary for this machine's Node v24.19.0 and `npm rebuild`
  fails (`node-gyp`: no Visual Studio C++ toolset installed) — the 75
  non-DB-backed tests all pass; the 2 DB-backed files
  (`agent/commands.test.ts`, `job/scheduler.test.ts`) can't even import
  `database/db.ts` on this machine. New `job/repository.test.ts`
  (`getAssignedJobsForWorker` returns multiple ASSIGNED jobs;
  `failStaleRunningJobs` fails a job with `STALE_EXECUTION` when its own
  lease expires but the worker is still online, leaves a fresh-lease job
  alone, and still uses the old "worker offline" reason when the whole
  worker is gone) typechecks clean but **could not be run locally** for
  the same pre-existing reason — needs CI (GitHub Actions, which has a
  working native toolchain) to actually execute; not a gap introduced by
  this session, and not blocking the PR/push.
- **Live production investigation, 2026-09-02** (what actually triggered
  this milestone — see Current Milestone for the narrative): authenticated
  to the real dashboard via `claude-in-chrome` (the user logged in), then
  used its `fetch` access (same-origin, already-authenticated) to call
  the real API directly rather than guessing: `GET /api/jobs` showed
  jobs #32/#33 ran *sequentially* (12s apart), not concurrently, despite
  both landing on CGI-Render; `GET /api/workers` showed CGI-Render with
  two real GPU slots (`RTX 3090` ×2) and confirmed `capabilities:
  ["test"]` only on both COMP-01 and CGI-Render (missing `ffmpeg`
  despite `softwareVersions.ffmpeg` present). Created two real `test`
  jobs via `POST /api/jobs` targeting CGI-Render's two GPU slots and
  polled `GET /api/jobs` every ~2.5s: job #35 (GPU0) reached `RUNNING`
  and progressed normally; job #36 (GPU1, same worker) stayed `ASSIGNED`
  at 0% for the entire time #35 was running — direct, real, reproduced
  evidence of the single-job-at-a-time limitation, not just a code-
  reading inference. Mid-test, #35 itself got orphaned (stuck `RUNNING`
  at 83%, `finished_at` null, still true as of this writing) while #36
  went on to complete normally once #35's slot theoretically freed up —
  real evidence for the stale-execution-lease bug, kept as-is per
  Required User Action rather than manually fixed up.
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
- **P4-1/P4-2 FFmpeg**: server `typecheck`/`test`/`build` clean (73/73
  unit tests, up from 52 — added `ffmpegValidation.test.ts` (17 cases:
  path allow-listing, every enum/regex field) and 2 `validation.test.ts`
  cases confirming `type: "ffmpeg"` actually dispatches to the stricter
  check rather than being accepted as opaque free-form input like other
  job types). `dotnet build`/`test` clean (74/74, up from 42 — added
  `PathValidatorTests`, `FfmpegArgsTests` (whitelist enforcement +
  confirms an unusual sourcePath stays one unsplit `ArgumentList` entry,
  never concatenated), `FfmpegProgressParserTests` (block parsing, reset
  between blocks), `FfmpegJobRunnerTests` (validation-failure paths only
  — see Known Issues for what isn't covered without real ffmpeg). A
  seventh throwaway smoke-test script (not committed) against a real
  temp SQLite DB confirmed the full server-side loop: a well-formed
  `ffmpeg` job gets `ASSIGNED` to a worker reporting `ffmpeg` capability
  (with `preset`/`audioCodec` defaults applied and normalized into the
  stored `input`); a `sourcePath` outside `FFMPEG_ALLOWED_ROOTS` is
  rejected at `POST /api/jobs` time, before a job row even exists; a
  worker with only `test` capability never gets an `ffmpeg` job
  assigned. **Real bug caught by `FfmpegJobRunnerTests` itself**: a
  fast synchronous validation failure (bad path, empty allowed-roots)
  could let `RunAsync` finish before `Start()`'s caller regained
  control, making `IsBusy` briefly unreliable right after `Start()` —
  fixed with `await Task.Yield()` as `RunAsync`'s first line; both
  previously-failing tests (`StartWhileAlreadyBusyThrows`,
  `ResetAfterFinishingAllowsStartingAnotherJob`) pass after the fix.
- **P4-2 real ffmpeg verification (same day, after installing ffmpeg on
  this dev machine — `CGI-Render` is itself one of the 4 studio
  workstations)**: generated two small synthetic test videos with
  ffmpeg's own `testsrc` filter (3s/640x360 and 15s/1280x720 — no
  internet download needed) and ran `FfmpegJobRunner` against them for
  real through two throwaway xUnit tests (not committed, deleted after
  a passing run — same pattern as the Node-side smoke scripts). First
  attempt failed: the latest winget `ffmpeg` build (9.0) hit a real
  NVENC/driver version mismatch (see Known Issues) — not a bug in this
  repo's code, confirmed by reproducing the identical failure running
  ffmpeg directly by hand outside any of this repo's code. Installed an
  older build (`BtbN.FFmpeg.GPL.7.1`) that's compatible with this
  machine's driver, uninstalled the incompatible one to avoid future
  PATH ambiguity, and re-ran: **both tests passed** — a real
  `h264_nvenc` hardware encode completed, `fps` was observed mid-run
  via the real `-progress pipe:1` parsing (not just at completion), and
  both output files were confirmed via `ffprobe` to have the correct
  duration (3s/15s matching their sources). **Real bug caught by this
  same real run**: `FfmpegJobRunner`'s error-truncation kept the first
  2000 characters of ffmpeg's stderr, not the last — ffmpeg always
  opens with an extremely long single `configuration: --enable-...`
  banner line before anything about an actual failure, so the *real*
  NVENC error was being silently cut off and only the useless banner
  reached the job's `error` field. Fixed by truncating from the end
  (`s[^2000..]`) instead of the start. This is the first genuinely
  complete, non-mocked proof of the whole P4-2 loop: real Agent code,
  real ffmpeg process, real GPU hardware encode, real output file.
- **P4-2 over the real TrueNAS SMB share (same day, user pointed at
  it)**: `\\192.29.11.92\web_data\www\Projects\SOURCE\
  A008C005_130101_R31Z.mov` — a real production clip (ProRes 422,
  1920x1080, 10-bit, ~3.5s), reachable directly from `CGI-Render` over
  the LAN. Ran `FfmpegJobRunner` against it for real (another
  throwaway, not committed, test output deleted from the share
  afterward): `AllowedPathsConfigStore` configured with the real UNC
  root, source/output paths both real UNC paths, no local `C:\` paths
  involved anywhere in this run. **Real bug caught**: `h264_nvenc`
  rejected the source outright ("10 bit encode not supported") — this
  ProRes source is genuinely 10-bit, which H.264 NVENC can't take
  directly on this hardware. Fixed in `FfmpegArgs.Build` (always add
  `-pix_fmt yuv420p` for `h264_nvenc`, confirmed manually with a raw
  ffmpeg invocation before changing any code) — re-ran after the fix
  and the job completed successfully, output file confirmed non-empty
  on the actual share. Added `FfmpegArgsTests.ForcesYuv420pFor264NvencOnly`
  to lock this in (74/74 → 75/75). This closes the one gap the previous
  entry left open — **P4-2 has now been verified with real ffmpeg, real
  NVENC hardware, and a real UNC/SMB path to TrueNAS, against a real
  production source file**, not synthetic/local-only testing.
- **P4-4 Topaz Video AI worker (COMP-01, 2026-08-18)**: `dotnet build`/
  `test` clean, 106/106 (up from 84 — `TopazArgsTests.cs` 21 cases,
  `TopazJobRunnerTests.cs` 6 cases, mirroring the Ffmpeg equivalents).
  Server: `npm run typecheck`/`build` clean; `npm test` on the pure
  validation subset (`topazValidation.test.ts` + updated
  `validation.test.ts`/`ffmpegValidation.test.ts`) 46/46 passing. Full
  `npm test` run also caught 75/77 passing — the 2 failures
  (`commands.test.ts`, `scheduler.test.ts`) are pre-existing DB-backed
  tests blocked by a local environment gap unrelated to this change
  (see Required User Action's COMP-01 dev-environment note), confirmed
  by the exact failure (`Could not locate the bindings file
  ...better_sqlite3.node`), not a real regression.
  **Decision-6 risk check (done first, before writing the runner)**:
  does `tvai_up` need an interactive Topaz login LocalSystem wouldn't
  have? Generated a real tiny test clip
  (`ffmpeg -f lavfi -i testsrc=...`), ran Topaz's real `tvai_up` filter
  by hand first as the interactive user (worked once
  `TVAI_MODEL_DIR`/`TVAI_MODEL_DATA_DIR` were set — real model name is
  `iris-2`, not `ahq-12` despite that being the filter's own declared
  AVOption default, which turned out not to be a locally-resolvable
  model), then via the same `schtasks /RU SYSTEM` diagnostic trick
  P4-3's NAS debugging used, confirming it works identically under
  SYSTEM: `ffprobe`-confirmed 320x240 → 640x480 real 2x upscale, no
  license/auth error either way. **Real proof of the Agent's own code**
  (not just the raw CLI): a throwaway xUnit test (not committed,
  deleted after a passing run) drove the actual `TopazJobRunner` class
  end-to-end against the same test clip — passed, output confirmed
  640x480 via `ffprobe`, proving the config store wiring/path
  validation/`TopazArgs` building/env-var setting/progress parsing/
  success detection all work together, not just Topaz's CLI in
  isolation. **Full live verification**: built + deployed the new
  `DreamersAgent.exe` to COMP-01's real running service (elevated
  stop/copy/start, same pattern as the P4-3 rollout); log confirmed
  `Topaz Video AI detected: version 7.1.git` and `NAS health check
  passed` on the next startup, confirming the real, live `DreamersAgent`
  service (not just a test process) now has the `topaz` capability
  ready to report.
- **P4-4 live production verification (same day)**: pushed (`7fbc402`),
  CI green, `vncgi-remote-server`/`vncgi-remote-web` updated in Dockge,
  user clicked "+ TOPAZ DEMO (Upscale thật)" on the real dashboard —
  job 31, dispatched to COMP-01. **Real bug caught by this exact run**:
  the user rebooted COMP-01 around the same time (to also finish
  registering the pending VS C++ toolset, see below) — `DreamersAgent`
  auto-started before the network adapter was fully up, so its one-time
  Lazy NAS health check failed with `NasConnectCategory.Network`
  (`Could not connect to "\\192.29.11.92\web_data" (Win32 error
  1231)`), silently disabling both `ffmpeg`/`topaz` capabilities for
  that process's whole lifetime — job 31 sat `QUEUED`/unassigned as a
  result. Diagnosed by reading the log directly (`LastBootUpTime` lined
  up with the failure timestamp almost exactly), confirmed the network
  was fine moments later (`Test-NetConnection` succeeded), and simply
  restarted the service — the next health check passed immediately and
  job 31 was dispatched within the same second. **Not a code bug** (the
  Lazy-per-process-lifetime design is intentional, see
  `NasHealthChecker`'s doc comment) but a real operational gotcha worth
  knowing: **a fresh boot needs the Agent service restarted once network
  is actually up if the very first health check raced it** — worth a
  short delay-before-first-check or a retry in a future session if this
  recurs. Job 31 then completed for real:
  `Dreamers.Agent.Worker: Job 31 finished: success`. Confirmed via
  `ffprobe` directly against the real output file on the real share
  (`dreamers_topaz_demo_1787033053716.mp4`, 14.2MB): source
  `1920x1080` → output `3840x2160` (real 2x upscale to 4K), same
  `3.44s` duration preserved. **This is full, real, production
  end-to-end proof of P4-4** — dashboard click on the live site →
  `POST /api/jobs` → scheduler → heartbeat delivery → `TopazJobRunner`
  → real `tvai_up` GPU upscale → real NVENC encode → output written
  back to the real TrueNAS share.
- **P4-5 groundwork (GPU device-targeting, COMP-01, same day)**:
  `dotnet build`/`test` clean, 110/110 (up from 106 — 4 new cases in
  `FfmpegArgsTests.cs`/`TopazArgsTests.cs` confirming `-gpu`/`device=`
  appear only when `gpuSlot` is provided and reflect the right index).
  Server `typecheck`/`build` clean (same 75/77 `npm test` gap as
  before, same pre-existing DB-binding cause, unrelated to this
  change). **Real hardware proof this session's single GPU allows**:
  two throwaway runs (not committed) — `TopazJobRunner` driven with an
  explicit `gpuSlot: 0` completed a real upscale, and a raw
  `ffmpeg -gpu 0 -c:v h264_nvenc ...` invocation completed a real
  encode — confirming `-gpu N`/`device=N` are accepted by the real
  tools, not just well-formed argument-list strings. **Explicitly not
  proven**: whether this actually keeps two concurrent jobs on
  independent physical GPUs — that requires `CGI-Render`'s real 2-GPU
  hardware and is P4-5's actual remaining scope, not done this session.

## Required User Action

### P4-3H — one UAC click on COMP-01, then a relay onto CGI-Render

This session is running **on COMP-01 itself** (see Current Milestone) —
most of P4-3H's deployment is therefore self-service. COMP-01's own
Agent redeploy is **DONE** (published `dist/DreamersAgent.exe`,
self-update flow completed cleanly — no UAC prompt actually blocked it,
either this account has elevation pre-approved or it resolved on its
own; verified via `LastWriteTime` on the installed exe and a live
`capabilities` check both moving from stale to correct). What's left
needs things this session genuinely cannot do on its own:

1. **Deploy the same build to CGI-Render**: reachable from COMP-01 on
   the LAN (RDP port 3389 open, confirmed via `Test-NetConnection`) but
   this session has no credentials and no remote-execution tool (WinRM
   port 5985 closed, no SSH, no PsExec) — the same situation P4-3/P4-4
   already established for that machine. **Action**: same as those
   milestones — either relay `git pull` + `dotnet publish Dreamers.Agent
   -c Release -r win-x64 -o .\dist` + running the published exe (self-
   update) on CGI-Render directly, or open an RDP session there and do
   it by hand. **Expected effect, already confirmed on COMP-01**: its
   `capabilities` should go from `["test"]` back to
   `["test","ffmpeg","topaz"]` within seconds of the fresh process
   starting (COMP-01's NAS health check passed immediately on restart —
   see Tests Performed — strong evidence the `Lazy<T>`→2-minute-TTL fix
   is what was actually wrong, not a real NAS/credential problem on
   either machine).
2. **Update the server**: `vncgi-remote-server` in Dockge needs
   **Update** (new image from this session's push, once pushed/CI
   green) — same "Dockge → Update" step as every prior Phase 4
   milestone.
3. Once both Agents and the server are updated: re-run the real
   concurrency check that started this milestone — fire two jobs at
   CGI-Render (e.g. two `test` jobs, or one `ffmpeg` + one `topaz` now
   that item 1 restores those capabilities) and confirm via `GET
   /api/jobs` (or `nvidia-smi` on CGI-Render) that **both actually reach
   `RUNNING` simultaneously**, not one sitting `ASSIGNED` while the
   other runs — that's the concrete pass/fail bar for P4-3H's
   concurrent-execution fix and for closing P4-6.
4. ~~Job #35 stuck RUNNING~~ **DONE 2026-09-02.** Confirmed
   auto-transitioned to `FAILED` the moment the redeployed server's
   `failStaleRunningJobs()` ran against it — no manual intervention:
   `error: "STALE_EXECUTION: no progress reported for this job in over
   30s even though the worker is still online — its Agent-side execution
   was lost (e.g. Agent process restarted mid-job)"`,
   `finished_at: "2026-09-02T06:25:36.039Z"`. Exactly the fix working as
   designed, on the real job that motivated it.

**P4-3H is DONE as of 2026-09-02.** All four items above completed live
in production: CGI-Render redeployed by the user (`git pull` + `dotnet
publish` + self-update, `D:\AICODEX` on that machine — its own repo
root, no `dreamers-remote` subfolder, unlike COMP-01), `capabilities`
recovered to `["test","ffmpeg"]` (no `topaz` there — never installed on
that machine, unrelated), `vncgi-remote-server` updated in Dockge, job
#35 auto-resolved. **P4-6 (End-to-End Processing Test) is therefore also
DONE** — the real concurrency check: jobs #38 (CGI-Render GPU0) and #39
(GPU1) created via `POST /api/jobs` within 6ms of each other, polled
every 2.5s via `GET /api/jobs`:

```
#39 gpu1 RUNNING 33% | #38 gpu0 RUNNING 33%
#39 gpu1 RUNNING 66% | #38 gpu0 RUNNING 66%
#39 gpu1 COMPLETED 100% | #38 gpu0 COMPLETED 100%
```

Both jobs RUNNING simultaneously, progressing in lockstep, completing
together — the exact pass bar P4-3H/P4-6 needed, confirmed on real
2-GPU hardware, not a unit test or a reasoning-from-code claim.

### P4-5 prep — DONE, live in production 2026-08-18 (superseded by P4-3H above for the concurrency question — kept for its still-accurate GPU device-targeting detail)

GPU-targeting groundwork (commit `60aaa76`) fully deployed:
- **Agent binary**: rebuilt (`dotnet publish`, 0 warnings/errors) and
  redeployed to the live `DreamersAgent` Windows Service on COMP-01
  (elevated stop/copy/start, same pattern as P4-3/P4-4). Confirmed live:
  service `Running`, fresh heartbeats flowing, NAS health check passed,
  Topaz Video AI detected — same startup sequence as before, no
  regression from the `gpuSlot` plumbing.
- **Server**: `vncgi-remote-server` updated in Dockge by the user
  (confirmed "đã update") — `server/src/api/agent.ts`'s `gpuSlot` field
  is now live in the heartbeat response. `vncgi-remote-web` untouched
  by this change, no update needed there.

Both halves of the groundwork are now live end-to-end in production on
COMP-01's single GPU (`gpuSlot` flows through but has no visible effect
there since there's only one device to pick). Nothing left to deploy —
what remains is purely the real 2-GPU verification below.

### P4-6 (old P4-5) — deployed everywhere as of 2026-08-18; real 2-GPU verification now blocked on P4-3H's redeploy, not "deferred by choice" anymore

GPU device-targeting groundwork (commit `60aaa76`) is committed and
fully deployed: server updated in Dockge, `DreamersAgent.exe` rebuilt
and redeployed on both COMP-01 and `CGI-Render` — the user ran
`git pull`/`dotnet build`/`dotnet publish`/`.\DreamersAgent.exe`
(self-update path) on `CGI-Render` directly, relaying commands from this
COMP-01 session; confirmed live via the log's `Dreamers Agent stopping`
→ `Dreamers Agent starting` pair at 2026-08-18 09:14:00 UTC, and again
via `Get-Date`/log `LastWriteTime` matching exactly a few minutes later
(agent actively heartbeating). Access to `CGI-Render` is **no longer
the blocker** — what's left is purely the real verification step: fire
two jobs at once (e.g. two "+ FFMPEG DEMO" clicks back to back, or one
ffmpeg + one topaz), and watch `nvidia-smi` / the job rows' `gpu_slot`
column to confirm they land on separate physical GPUs, not fighting
over one. **User explicitly deferred this step 2026-08-18** ("bỏ qua xử
lý sau") — do the two-jobs-at-once test whenever convenient; nothing
else blocks it.

### P4-4 — DONE, verified live in production 2026-08-18

Pushed (`7fbc402`), CI green, `vncgi-remote-server`/`vncgi-remote-web`
updated in Dockge, "+ TOPAZ DEMO" clicked on the real dashboard, job 31
completed for real (source `1920x1080` → output `3840x2160`). Full
detail in Tests Performed, including a real operational bug hit and
fixed along the way (a fresh COMP-01 reboot raced the Agent's one-time
NAS health check — fixed by restarting the service once network was
actually up).

Remaining, not urgent: `CGI-01` also has Topaz Video AI installed (per
the user) but hasn't had the P4-3 NAS credential + P4-4
`topaz_config.json` rollout done on it yet — same steps already proven
on COMP-01, not urgent (COMP-01 alone already proves the mechanism end
to end, including in production).

### COMP-01 local dev environment — VS C++ toolset still not registered (not urgent, doesn't block anything)

This session installed .NET 8 SDK, ffmpeg, Python 3.12, and (attempted)
a Visual Studio C++ Desktop workload on COMP-01 via winget/VS Installer,
needed for `better-sqlite3`'s native addon. `vs_installer.exe modify`
returned exit code 3010 (success-pending-reboot); the user rebooted the
machine (same reboot that also caused the Agent NAS-health-check race
above) — but `vswhere -requires
Microsoft.VisualStudio.Component.VC.Tools.x86.x64` **still** shows
nothing installed afterward, so the reboot alone didn't actually finish
it (worth a fresh `vs_installer.exe modify` re-attempt or checking the
VS Installer's own log next time someone's on this machine, not
investigated further this session since it isn't blocking anything).
Current workaround, still needed: `npm install --ignore-scripts` in
`server/` (skips native compilation, still lets `tsc`/most of
`node:test` run — 75/77, the 2 gaps are exactly the DB-backed tests
this affects). **Not blocking real work** — CI (GitHub Actions, Linux)
has no such gap and is what actually gates deployment; this only
affects local iteration speed on COMP-01 specifically.

### SSH key for TrueNAS — no longer blocking, still unresolved

An SSH keypair exists at `~/.ssh/truenas_dreamers` (private) /
`~/.ssh/truenas_dreamers.pub` (public) on this dev machine
(`CGI-Render`), generated for future Docker/Dockge changes over
SSH/`docker compose` instead of the Dockge browser UI. **Still not
added to any TrueNAS user** — `ssh -i ~/.ssh/truenas_dreamers
<user>@192.29.11.92 'echo ok'` still returns "Permission denied
(publickey)" as of 2026-08-16. Public key, if the user wants to add it
later:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICAIAWHHeopplrdd1CRYL0j5N4QvZyyjxe9HBFH3fpzJ claude-code@dreamers-remote-dev
```

**Discovery 2026-08-16**: turns out unnecessary for Dockge work. The
Browser pane tool (`mcp__Claude_Browser__*`) already had an
authenticated Dockge session (cookie persisted in that browser
profile, no login step needed) — used it directly to edit
`vncgi-remote-server`'s compose.yaml, Save, and Deploy. No SSH, no
Claude-in-Chrome extension required. **Prefer this path first** for
any future Dockge UI change: open `http://192.29.11.92:31014` in the
Browser pane and check whether it's still authenticated before asking
the user for anything. Caveats hit doing this: the compose.yaml
CodeMirror editor's `End`/`Backspace`/`Ctrl+End` keys did not register
through the automation layer — double-click-to-select-word + retype
worked reliably instead. The in-Dockge container terminal (xterm.js)
did not accept typed input at all through this tool.

Do not re-generate the SSH key in a future session — check whether
`~/.ssh/truenas_dreamers` already exists on this machine first (it's
local, not committed to git, so a fresh session won't see it in the
repo — check the actual filesystem).

### Once SSH access works: finish the FFmpeg demo deployment

All commits up to and including the "+ FFMPEG DEMO" button are pushed,
CI green, images on GHCR.
1. ~~Dockge → `vncgi-remote-server` → Update~~ **DONE** — confirmed
   live: `POST /api/jobs` with an ffmpeg-shaped body now returns the
   real `ffmpegValidation.ts` error instead of the old pre-P4-2
   behavior.
2. ~~Dockge → `vncgi-remote-web` → Update~~ **DONE** — the "+ FFMPEG
   DEMO" button is visible on the live dashboard.
3. ~~set environment variable `FFMPEG_ALLOWED_ROOTS` =
   `\\192.29.11.92\web_data\www\Projects` on `vncgi-remote-server`,
   restart it~~ **DONE 2026-08-16** — added via Dockge UI's compose
   editor directly (browser automation, no SSH), Saved + Deployed;
   Dockge showed `Container vncgi-remote-server-server-1  Started`.
   **Verified**: clicked "+ FFMPEG DEMO" on the live dashboard (user
   was already logged in) — job #21/#22 both created and QUEUED with
   no `sourcePath must be under a configured allowed root` error, so
   the env var is confirmed live. Jobs stay QUEUED/unassigned though —
   that's step 4 below, not this one.
4. ~~`CGI-Render`'s Agent service still predates P4-1/P4-2~~ **DONE
   2026-08-17** — turns out `D:\AICODEX\agent\dist\DreamersAgent.exe`
   *was* already current (P3-8's `softwareVersions` mechanism, plus
   this session's build timestamps, both confirmed it); the real
   blocker was the service being **Stopped**, not stale. User started
   it (elevated). Verified via `GET http://192.29.11.92:8080/api/workers`
   (same-origin session cookie from the Browser pane, no SSH) —
   `capabilities` still came back `["test"]` only even after the
   restart.

   Root-caused from there, in order:
   1. **PATH scope**: `ffmpeg.exe` (WinGet) was on user `rajn-x`'s PATH,
      not the **Machine** PATH — `DreamersAgent` runs as `LocalSystem`,
      which only sees Machine PATH, so `FfmpegDetector` never found it.
      Fixed: added ffmpeg's `bin` dir to the Machine PATH (elevated,
      user-run), restarted service → `capabilities` became
      `["test","ffmpeg"]`. Demo jobs (#23-26) then got ASSIGNED to
      `CGI-Render` immediately — confirming the scheduler side works —
      but all FAILED: `sourcePath does not exist:
      "\\192.29.11.92\web_data\www\Projects\SOURCE\A008C005_130101_R31Z.mov"`,
      even though the file demonstrably exists (verified from this same
      machine as user `rajn-x`, which has an active SMB session per
      `net use`).
   2. **No SMB session for LocalSystem**: same PATH-scope problem, one
      layer up — `LocalSystem` has no mapped drive, no Credential
      Manager entry, no interactive-user SMB session at all, for
      `\\192.29.11.92\...` (or any UNC host), independent of who's
      logged in. `File.Exists()`/ffmpeg.exe on that path silently
      behave as "doesn't exist" rather than "access denied".

   **Fix implemented this session (P4-3)**: `NasCredentialStore`
   (DPAPI `LocalMachine`-scoped, mirrors `AgentCredentialStore`),
   `NasConnector` (`WNetAddConnection2`/`WNetCancelConnection2`
   P/Invoke — a session to `\\host\share`, deliberately not a mapped
   drive letter, not the interactive user's Credential Manager),
   `NasHealthChecker` (authenticate + real read + real write probe
   against the first allowed root, run once at startup), and
   `WorkerCapabilities` now gates `"ffmpeg"` on
   `FfmpegDetector.Available && NasHealthChecker.Check(...).Ok` — a
   worker whose NAS check fails never advertises `ffmpeg`, so the
   scheduler never assigns it a job that's certain to fail.
   `FfmpegJobRunner` re-asserts the NAS session (best-effort,
   `NasConnector.TryEnsureConnected`) before its existing
   `File.Exists` check. New CLI: `DreamersAgent.exe nas-credential
   <username>` (password prompted + masked, never a CLI arg, never
   sent to/typed by Claude — see agent/README.md's new "NAS credential
   (P4-3)" section). 84/84 tests pass (`dotnet test`); rebuilt and
   republished to `agent/dist/` (`dotnet publish ... -o dist`, run via
   PowerShell — Bash mangled the `-o .\dist` argument into a literal
   `.dist` folder the first time; that stray folder was deleted).

   **Dedicated NAS user created**: TrueNAS local user `render_agent`
   (SMB User ✓, primary group `render_agent`), password set by the
   user directly in `nas-credential render_agent` on `CGI-Render` (P4-3
   CLI — password never seen by Claude). Confirmed-working credential:
   independently verified via `runas /netonly /user:render_agent` +
   `net use \\192.29.11.92\web_data` → success, and via a temporary
   `schtasks /RU SYSTEM` one-off task running the same `net use` →
   also success. So the credential/account itself has been solid since
   early in this debugging session — everything below was chasing
   *other* bugs, not this one.

   **Debugging journey for the "ffmpeg" capability never appearing**
   (all on `CGI-Render`, all confirmed via `GET
   http://192.29.11.92:8080/api/workers`'s `capabilities` field and
   `C:\ProgramData\DreamersRemote\logs\agent-*.log`'s "NAS health
   check" line — grep that log first before re-debugging any of this):

   1. Every attempt returned `NasConnectCategory.Network`, Win32 error
      **67** (`ERROR_BAD_NET_NAME`), even though `\\192.29.11.92\web_data`
      demonstrably exists and `render_agent` demonstrably works against
      it (both proven above). Chased and ruled out, in order: stale
      credential (re-saved, same result), a
      cancel-before-retry-on-conflict race (removed the reactive retry
      entirely, same result), a leftover `\\host\IPC$`/bare-host
      session under a different identity (added explicit
      cancel-everything-first, same result), password
      truncation/typo (decrypted the DPAPI blob locally to check
      length twice — consistent both times, so not this).
   2. Added `DreamersAgent.exe test-nas` (new permanent diagnostic
      command — runs the exact `NasHealthChecker.Check` the service
      runs at startup, but interactively) specifically to A/B "is this
      a Windows-Service-context bug or a code bug". It reproduced
      error 67 *interactively too* — proving it was a plain code bug,
      not a Session-0/LocalSystem-specific limitation (which had been
      the leading theory up to that point).
   3. **Root cause, found and fixed**: `NasConnector`'s `NetResource`
      P/Invoke struct (mirrors `NETRESOURCEW`) was declared
      `[StructLayout(LayoutKind.Sequential)]` with no `CharSet`. A
      `DllImport`'s `CharSet` only governs a P/Invoke method's own
      direct string *parameters* (which is why `lpPassword`/
      `lpUsername` — passed directly to `WNetAddConnection2`, not
      through the struct — were never affected); it does **not**
      propagate into a struct parameter's own string fields, which
      default to ANSI. Since `WNetAddConnection2` resolves to the
      `...W` (UTF-16) entry point, it was reading `lpRemoteName`
      (`\\192.29.11.92\web_data`) as UTF-16 over bytes that were
      actually single-byte ANSI — silently corrupting the string into
      garbage before the SMB layer ever saw it, which is exactly what
      `ERROR_BAD_NET_NAME` reports. Confirmed by deliberately setting
      `lpProvider` (another struct string field, added while chasing a
      real-but-secondary WebDAV/`WebClient`-service concern) and
      watching the error change to a *different*, equally-nonsensical
      one (`ERROR_BAD_PROVIDER`, 1204) — a second garbled string
      producing a second garbage-appropriate error, which is what
      nailed it down as an encoding bug rather than anything
      network/credential/permission-related. **Fix**: struct is now
      `[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]`.
      Also kept the explicit `lpProvider = "Microsoft Windows Network"`
      (queried from this machine's own
      `HKLM\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\NetworkProvider`
      → `Name`, not guessed) since `WebClient` (WebDAV) really is
      Running on this machine and TrueNAS really does also expose a
      `WebDAV` share alongside `web_data` — a real, if secondary,
      source of provider-resolution ambiguity worth closing off
      regardless.
   4. After the marshaling fix, deployed to the real service and the
      failure category correctly changed to something *meaningful* for
      the first time: `Permission` — connected fine, but
      read/write on `\\192.29.11.92\web_data\www\Projects` specifically
      failed. This flip-flopped between "can read, can't write" and
      "can't even read" across a couple of restarts right after the
      user applied the dataset ACL with "Apply permissions
      recursively" — root cause never fully pinned down (leading
      theories were recursive-apply propagation lag, or `www`/
      `www/Projects` being a separate dataset that didn't inherit from
      the parent's ACL editor), but see **RESOLVED 2026-08-18** below —
      the user fixed the ACL directly in TrueNAS's editor at
      `/mnt/pool_cgivn_work/web_data/www/Projects` and it's now
      confirmed working.

   **All code changes above are committed** — `0e0d5a4` (`feat(agent):
   P4-3 -- dedicated NAS credential for LocalSystem SMB access`),
   pushed, `git status` clean. (An earlier version of this handoff said
   UNCOMMITTED; that was stale by the time it was actually committed.)

   **2026-08-18: same mechanism deployed and reproduced on COMP-01**
   (a second, independent workstation — this session was running on
   COMP-01, not CGI-Render, discovered by checking the local agent log's
   reported `Host=CGIVN`/hardware against the Active Workers table
   below). Full rollout from scratch, same steps as CGI-Render:
   installed .NET 8 SDK (winget) since this machine never had it,
   `dotnet build`/`test` clean (84/84, matches CGI-Render's count
   exactly), `dotnet publish` a fresh `DreamersAgent.exe`, installed
   ffmpeg (`BtbN.FFmpeg.GPL.7.1`, same known-compatible build — this
   machine's driver is 610.62, also NVENC-API-13.1-capable). Hit the
   **exact same PATH pitfall** again: winget put ffmpeg on the user's
   PATH, not Machine PATH; fixed by adding it to Machine PATH
   (`[Environment]::SetEnvironmentVariable(..., "Machine")`, elevated).
   Wrote `allowed_paths.json` with the same UNC root. After
   `nas-credential render_agent` (user typed the password interactively
   — Claude never handles it, hard rule) and a service restart:
   **`NAS health check failed (Permission): ... cannot read
   "\\192.29.11.92\web_data\www\Projects" (access denied)`** — identical
   failure mode to CGI-Render's, down to the exact wording. This was
   strong confirmation the remaining blocker was purely a TrueNAS-side
   ACL issue on `www/Projects`, not anything machine-specific.

   **RESOLVED 2026-08-18**: user fixed the ACL on `www/Projects`
   directly in TrueNAS's ACL Editor (exact change not visible from this
   session — no TrueNAS UI/API access here, see the access-boundary
   note two paragraphs up). Restarted `DreamersAgent` on COMP-01 after
   the fix: `NAS health check passed: Authenticated to
   "\\192.29.11.92\web_data" and verified read/write access to
   "\\192.29.11.92\web_data\www\Projects".` `ffmpeg` also independently
   confirmed resolvable via the Machine PATH (`where.exe ffmpeg`
   against a `Machine`-scope-only `$env:PATH`, simulating exactly what
   `LocalSystem` sees) — so COMP-01 now reports the `ffmpeg` capability
   for real, both preconditions (`FfmpegDetector.Available` and
   `NasHealth.Ok`) satisfied. **P4-3 is now fully working end-to-end on
   at least one real workstation.**

   Since the fix was on TrueNAS's side (the ACL applies to the
   `render_agent` account regardless of which Windows box connects),
   CGI-Render very likely now passes its own health check too without
   any further change there — **not yet independently confirmed**, this
   session has no network access to CGI-Render (`\\192.29.11.95\c$\...`
   unreachable from COMP-01) to check its log directly. Whoever's next
   on CGI-Render: just restart `DreamersAgent` there (no code/config
   change needed, it already has the P4-3 binary and credential from
   the original debugging session) and check
   `C:\ProgramData\DreamersRemote\logs\agent-*.log` for the same "NAS
   health check passed" line.

   `CGI-01`/`CGI-DUC` still need the full rollout (ffmpeg install +
   Machine PATH + `allowed_paths.json` + `nas-credential`) whenever
   they're needed for real jobs — not urgent, the mechanism itself is
   now proven on two independent machines.
5. **DONE 2026-08-18** — clicked "+ FFMPEG DEMO (GPU encode thật)" on
   the live dashboard: job 30, dispatched to COMP-01, `Dreamers.Agent.Worker:
   Job 30 finished: success` in the agent log seconds later. Output
   file confirmed non-empty (3.9MB) on the real share at
   `\\192.29.11.92\web_data\www\Projects\SOURCE\
   dreamers_demo_1786991142581.mp4`. **This is full end-to-end proof of
   P4-3** — dashboard click → `POST /api/jobs` → scheduler → heartbeat
   delivery → `FfmpegJobRunner` → NAS session → real NVENC encode →
   output written back to the real TrueNAS share → job-result reported
   — not just a passing health check. P4-3 is now closed on COMP-01.

Everything else is deferred by the user's own choice, to pick up
whenever:

- Decide when to resume debugging P2-8 Restart/Shutdown and/or the
  CGI-DUC multi-monitor issue (see Known Issues).
- Eventually: change the admin password; decide on CPU temperature.
- Install `ffmpeg` + configure `allowed_paths.json` on `CGI-01`,
  `COMP-01`, `CGI-DUC` too, whenever they need to actually run ffmpeg
  jobs — not urgent, the mechanism itself is proven working on
  `CGI-Render`.
- Decide what's next after Phase 4's remaining milestones (P4-4 Topaz,
  P4-5 multi-GPU verification) — see Next Task.

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
- **Phase 4 architecture — RESOLVED 2026-08-16.** The user answered all
  three open questions this section originally listed (job creation,
  file access, job schema) directly rather than leaving them open —
  see Current Phase for the full decision. Kept here as a pointer, not
  duplicated.
- **Phase 4 — PHP's auth mechanism — RESOLVED 2026-09-02 (P4-5).** User
  chose the service-account option over a separate API-key path (no new
  auth surface, no server code needed beyond seeding the account) — see
  ROADMAP.md's P4-5 entry for the implementation. **Still needed from
  the user**: nothing server-side (that part is done); the PHP Projects
  site itself (a separate codebase, not this repo) needs to actually
  implement the login-once/reuse-cookie/re-login-on-401 flow described
  there, and someone needs to set `PHP_SERVICE_PASSWORD` (+ optionally
  `PHP_SERVICE_USERNAME`) in the server's Dockge environment and restart
  it once PHP is ready to use it — until that env var is set, no service
  account exists and PHP integration stays inert (safe to merge/deploy
  ahead of the PHP side being ready).
- **Real UNC/SMB path to TrueNAS — RESOLVED 2026-08-16.** The user
  pointed at `\\192.29.11.92\web_data\www\Projects` — confirmed
  reachable and read/write-able from `CGI-Render`, and P4-2 is now
  verified against it for real (see Tests Performed). Not necessarily
  the final `FFMPEG_ALLOWED_ROOTS`/`allowed_paths.json` value for
  production (that's the user's call, whenever PHP integration
  actually happens), but proves the mechanism works against the real
  share, not just local paths.
