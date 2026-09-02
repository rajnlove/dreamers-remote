# Roadmap

## V1 milestones (in order — do not skip ahead)

- **M0 — Documentation + skeleton.** Repo structure, docs, empty
  server/web/docker scaffolding.
- **M1 — VNC proof of concept.** Browser -> noVNC -> websockify -> UltraVNC
  -> a real Windows PC, with no dashboard yet. This is the milestone that
  proves the whole idea works.
- **M2 — Backend workstation manager.** Express API, SQLite, CRUD, TCP
  online/offline probe.
- **M3 — Web dashboard.** Workstation cards, online/offline indicator,
  Remote/Wake buttons, auto-refresh.
- **M4 — Integrated remote page.** `/remote/:id` resolves the workstation
  from the DB and opens the noVNC viewer; fullscreen, disconnect/reconnect,
  Ctrl+Alt+Del if feasible.
- **M5 — Wake-on-LAN.** Real magic-packet test against a real NIC.
- **M6 — Authentication.** Single admin account, hashed password, sessions.
- **M7 — Permissions.** Admin / Artist / Viewer roles.
- **M8 — Audit log.** login, remote session start/end, wake, workstation
  add/edit/delete. Never log passwords, keystrokes, or clipboard content.

## Phase 2 — Dreamers Agent (monitoring + safe management)

A separate subsystem, layered on top of V1 without modifying the VNC
remote-desktop flow. See [ARCHITECTURE.md](ARCHITECTURE.md#phase-2--dreamers-agent-monitoring--safe-management)
for the design. Milestones (in order — do not skip ahead):

- **P2-0 — Docs.** Update ARCHITECTURE.md/ROADMAP.md/PROJECT_STATUS.md
  for Phase 2. No code.
- **P2-1 — Agent skeleton.** `agent/Dreamers.Agent` (.NET 8 Worker
  Service) runs as a Windows Service; file logging with rotation; config
  + agent identity (UUID) persisted in `C:\ProgramData\DreamersRemote\`;
  install/uninstall/start/stop CLI. No metrics, no server communication
  yet.
- **P2-2 — Basic system metrics.** CPU, RAM, OS, hostname, uptime.
  Logged locally, not yet sent anywhere.
- **P2-3 — GPU monitoring.** NVML (or a stable wrapper), multi-GPU
  (`gpus[]`), must not crash on machines without an NVIDIA GPU.
- **P2-4 — Disk + process monitoring.** Local drives (total/used/free);
  configurable list of monitored VFX process names
  (`monitored_processes.json`).
- **P2-5 — Agent ↔ Server communication.** Registration (token-based
  pairing, not a bare workstation IP), heartbeat + metrics payload,
  `agentOnline` derived from heartbeat freshness (mark offline after
  15-30s of silence).
- **P2-6 — Dashboard integration.** Workstation cards show live metrics.
  Must not touch the existing Remote button/flow.
- **P2-7 — Workstation detail page.** `/workstations/:id` — overview,
  CPU/RAM/GPU/disk/process detail, controls.
- **P2-8 — Restart/Shutdown commands.** Structured command enum only
  (`restart`, `shutdown`, ...), never arbitrary shell; auth + permission
  check server-side, confirmation dialog client-side, audit log entry
  per command.
- **P2-9 — Agent installer/deployment docs.** How to push
  `DreamersAgent.exe` to multiple workstations and register each one.

**Explicitly out of scope for Phase 2** (V3+ or never): remote file
manager, remote terminal/arbitrary shell, PowerShell console, render
manager, historical graphs, Prometheus/Grafana, NVENC/AV1/custom remote
codec, internet access, mobile app.

## Phase 3 — Dreamers Job Engine

Started 2026-08-16. A generic queue/scheduler/worker foundation shared
by all future processing and rendering — not a separate queue per
application. See
[MASTER_PROJECT_SPEC.md §13-16](MASTER_PROJECT_SPEC.md#13-phase-3--dreamers-job-engine-future)
for the full requirements this phase works toward. Phase 3 itself does
**not** implement any real job type (FFmpeg/Topaz are Phase 4, render
apps are Phase 5) — it proves the engine works using a trivial built-in
job type, so the queue/scheduler/worker/GPU-slot machinery is real and
tested before anything depends on it. Milestones (in order — do not
skip ahead):

- **P3-0 — Docs.** This section, plus ARCHITECTURE.md/PROJECT_STATUS.md
  updates for Phase 3. No code.
- **P3-1 — Job data model.** `jobs` table: `id`, `type`, `status`,
  `priority`, `created_at`, `started_at`, `finished_at`, `worker_id`,
  `gpu_slot`, `progress`, `input`, `output`, `error`, `retry_count`.
  Status enum: `QUEUED`, `ASSIGNED`, `RUNNING`, `PAUSED`, `COMPLETED`,
  `FAILED`, `CANCELLED`. Basic CRUD API (create/list/get/cancel) —
  jobs just sit `QUEUED`, nothing assigns them yet.
- **P3-2 — Worker capability + GPU slot reporting.** Extend the
  Agent's heartbeat with a capability list (starts with just a `test`
  capability — real software capabilities like FFmpeg/Houdini are
  Phase 4/5's problem) and expose each Agent's already-collected
  `gpus[]` as independent, individually assignable GPU slots
  (`workstation_id` + `gpu_index`), per MASTER_PROJECT_SPEC.md §3's
  "1 machine != 1 GPU worker slot."
- **P3-3 — Basic scheduler.** FIFO assignment of `QUEUED` jobs to
  workers with a matching capability and a free GPU slot. No priority
  ordering, no dependency graph yet — those are P3-6.
- **P3-4 — Job execution on the Agent.** Same delivery pattern as
  P2-8's commands (assigned job rides the next heartbeat response, no
  inbound listener on the Agent). Built-in `test` job type: sleep N
  seconds, report progress 0-100 back to the server, then complete —
  proves the full loop end-to-end without any real workload attached.
- **P3-5 — Job lifecycle.** Cancel, retry (with `retry_count`),
  failure handling. Pause/resume only if the `test` job type can
  actually support it cleanly; otherwise defer pause/resume to
  whichever Phase 4/5 job type first needs it.
- **P3-6 — Priority + workstation availability + dependency.**
  Priority-ordered scheduling; workstation states
  (`AVAILABLE`/`BUSY`/`DISABLED`/`DEDICATED_WORKER`/`INTERACTIVE`) with
  configurable thresholds gating new assignment (GPU/RAM/CPU usage,
  manual disable); basic job dependency (job B waits for job A).
- **P3-7 — Jobs dashboard page.** Queue view, per-job status/progress,
  cancel button, "create a test job" control for exercising the engine
  without needing a real Phase 4/5 workload yet.
- **P3-8 — Software version compatibility (mechanism only).** Agent
  reports installed software versions; scheduler can reject a
  version-incompatible worker. No real software checks yet (nothing to
  check until Phase 4/5 installs real tools) — build the generic
  report/compare mechanism now so Phase 4/5 just plugs into it.

**Explicitly out of scope for Phase 3**: any real FFmpeg/Topaz/render
execution (Phase 4/5), Octane/plugin-specific license checks (Phase 5),
Studio Control Center dashboard (Phase 6/7 in MASTER_PROJECT_SPEC.md's
numbering).

## Phase 4 — Processing (FFmpeg + Topaz)

Started 2026-08-16 (explicit user request). The first real job type on
top of Phase 3's job engine — the queue/scheduler/GPU-slot/capability/
software-version machinery already exists and works
(`docs/PROJECT_STATUS.md`'s Phase 3 section); Phase 4 plugs a real
workload into it instead of the `test` placeholder. See
[MASTER_PROJECT_SPEC.md §17-20](MASTER_PROJECT_SPEC.md#17-phase-4--ffmpeg-processing-future)
for the full requirements. **Architecture decided by the user
2026-08-16** (see `docs/PROJECT_STATUS.md`'s Phase 4 section for the
full decision) rather than left as open questions: the existing PHP
Projects site (`http://192.29.11.92:8088/Projects` — web/display route
only, never a source path) is the job-creation side and calls
`POST /api/jobs` directly; a Windows worker reads/writes files via a
configurable UNC path straight to TrueNAS storage
(`\\192.29.11.92\Projects\...`), never through the Dreamers API; both
server and Agent independently validate every path against a
configured allow-list before touching it.

- **P4-0 — Docs.** This section, plus PROJECT_STATUS.md's open
  questions. No code.
- **P4-1 — FFmpeg capability + real capability detection.** DONE.
  Agent's `FfmpegDetector` (`Dreamers.Agent.Core/Ffmpeg/`) runs
  `ffmpeg -version`/`-encoders` once per process lifetime (real check,
  replacing P3-2's hardcoded `["test"]`-only capability list) and
  reports `ffmpeg` as a capability plus its real version via P3-8's
  software-version mechanism when found; NVENC encoder support
  (h264/hevc/av1) detected but not yet surfaced beyond internal
  `FfmpegInfo` (nothing consumes it yet — added when a concrete need
  shows up, e.g. rejecting an av1_nvenc job on a build that doesn't
  support it).
- **P4-2 — FFmpeg job runner, end to end.** DONE. Job schema
  (`type: "ffmpeg"`, structured `input`: sourcePath/outputPath/codec/
  qualityMode/quality/bitrate/preset/resolution/audioCodec/projectId)
  validated server-side (`server/src/job/ffmpegValidation.ts`) against
  `FFMPEG_ALLOWED_ROOTS`; Agent's `FfmpegJobRunner`
  (`Dreamers.Agent.Core/Jobs/`) independently re-validates against its
  own `allowed_paths.json` (`AllowedPathsConfigStore`), confirms the
  source exists, builds a whitelisted argument list only
  (`FfmpegArgs` — never a raw command string, never `UseShellExecute`),
  runs `ffmpeg.exe` with `-progress pipe:1` for machine-readable
  progress (`FfmpegProgressParser`), reports `progress`/`fps`/
  `eta_seconds` on every heartbeat (new `jobs.fps`/`jobs.eta_seconds`
  columns, generic — not FFmpeg-specific), and only reports success if
  the exit code is 0 **and** the output file actually exists. Worker.cs
  now dispatches to one of several `IJobRunner`s by job `type`
  (`test`/`ffmpeg`) instead of hardcoding `TestJobRunner` — the seam
  P4-4's Topaz runner plugs into. **Not yet tested against a real
  encode** — this dev machine has no `ffmpeg`/`ffprobe` on PATH; tested
  as far as the environment allows (unit tests for path validation,
  arg-whitelisting, progress parsing, and the full server-side
  create→validate→schedule→assign loop against a real temp SQLite DB —
  see PROJECT_STATUS.md's Tests Performed). **Needs verification on a
  real workstation** with ffmpeg installed and a real SMB mount before
  calling this fully proven, the same way P3-7's job loop needed a real
  Agent redeploy to go from "unit-tested" to "actually proven."
- **P4-3H — Processing Infrastructure Hardening.** IN PROGRESS. Inserted
  2026-09-02 ahead of the old P4-3/P4-5 (renumbered P4-5/P4-6 below) after
  live testing on the real production system surfaced three real gaps in
  the job engine's execution model itself — not new features, fixes to
  make the P4-1/P4-2/P4-4 machinery actually trustworthy under real
  concurrent/failure conditions:
  - **Stale/orphan RUNNING job recovery.** `failStaleRunningJobs()` used
    to only check the *worker's* heartbeat freshness — a job whose
    specific Agent-side execution died (e.g. the Agent process restarted
    mid-job) while the worker kept heartbeating fine would sit RUNNING
    forever, invisible to that check. Real incident: job #35 on
    CGI-Render, 2026-09-02 (see `docs/PROJECT_STATUS.md`). Fixed with a
    per-job execution lease (`jobs.last_progress_at`, refreshed by
    `startJob`/`updateJobProgress`) — a RUNNING job is now failed with
    `STALE_EXECUTION` if its own lease expires (30s), independent of
    whether the worker itself is still online.
  - **Capability re-registration after Agent restart.** `WorkerCapabilities.NasHealth`/`TopazInfo`
    were `Lazy<T>` — computed once, ever, per process lifetime. A NAS
    check that failed transiently right at Agent startup (network/SMB not
    fully up yet) stayed "unhealthy" forever after, silently dropping
    `ffmpeg`/`topaz` from `capabilities` until a human noticed and
    restarted the service again. Now re-checked every 2 minutes instead
    of once.
  - **True concurrent execution per GPU slot.** DONE, unit-tested (113/113
    Agent tests green), **verified live against real concurrent hardware**
    (CGI-Render, two RTX 3090s, 2026-09-02 — see
    `docs/PROJECT_STATUS.md`'s Tests Performed). This was P3-4/P4-2's
    original "one job at a time across the whole Agent" simplification —
    confirmed live to mean a job assigned to a second free GPU slot on a
    multi-GPU workstation just sat ASSIGNED, never actually running
    concurrently with the first, even though the scheduler had correctly
    reserved two independent slots. Each `IJobRunner` (Test/Ffmpeg/Topaz)
    now tracks every job it's running independently by job id instead of
    a single shared slot; Worker.cs no longer gates starting a new job on
    any global "busy" flag — the server's per-(worker, gpu_slot) busy
    tracking (job/scheduler.ts, unchanged) is the sole authority on not
    double-booking a GPU. Both Agent and server keep backward-compatible
    legacy singular fields (`runningJob`/`job`/`cancelJobId`) alongside
    the new plural ones, so a mixed fleet (some workstations redeployed,
    some not) keeps working exactly as before on the old side. **Not yet
    done**: deploying the rebuilt Agent to COMP-01/CGI-Render and
    re-running the real concurrent-jobs check that originally surfaced
    this (two real jobs on CGI-Render's GPU0+GPU1 at once, this time
    both actually RUNNING simultaneously, not one ASSIGNED-and-waiting) —
    blocked on remote execution access to those workstations from this
    session, see `docs/PROJECT_STATUS.md`'s Required User Action.
- **P4-4 — Topaz as a second, independent worker type.** DONE. Per
  MASTER_PROJECT_SPEC.md §20: its own capability/job type, not
  hardcoded into the scheduler alongside FFmpeg — confirmed true, zero
  scheduler/API changes needed (`findAssignment` already matches
  generically on `worker.capabilities.includes(jobType)`). `topaz` job
  type mirrors `ffmpeg`'s file structure closely (`TopazJobRunner`,
  `TopazArgs`, `topazValidation.ts`, ...), reusing `ffmpeg`'s
  codec/quality enums and NAS/allowed-roots config rather than
  duplicating them. v1 scope is upscale only (`tvai_up`) — frame
  interpolation/stabilization deferred. Verified end-to-end on a real
  workstation (COMP-01): real Topaz Video AI, real `tvai_up` upscale,
  confirmed working under both an interactive session and a
  LocalSystem-equivalent context (no license/login blocker, unlike
  P4-5's NAS problem below). See `docs/PROJECT_STATUS.md`'s Current
  Milestone and Tests Performed for full detail.
- **P4-5 — PHP Projects → Job Engine Integration.** Renumbered from the
  old P4-3 2026-09-02 (no scope change). Nothing to build here per the
  user's architecture decision — the PHP Projects site calls
  `POST /api/jobs` directly with `type: "ffmpeg"` (session-cookie
  auth, same as every other `/api/jobs` caller today). **Open item**:
  PHP calling a session-cookie-authenticated endpoint implies either a
  service account it logs in as, or a separate server-to-server auth
  mechanism this repo doesn't have yet — not blocking P4-1/P4-2 (which
  don't care who the caller is), but needs an answer before PHP can
  actually call it for real.
- **P4-6 — End-to-End Processing Test.** IN PROGRESS. Renumbered from the
  old P4-5 ("Multi-GPU verification with real workloads") 2026-09-02 —
  same goal, now correctly sequenced *after* P4-3H instead of before it,
  since live testing 2026-09-02 proved the old Agent literally could not
  run two jobs concurrently regardless of GPU-slot assignment (P4-3H's
  finding). P3's scheduler already assigns independent GPU slots
  (`workstationId` + `gpuIndex`) rather than treating a multi-GPU machine
  as one unit; this milestone confirms that holds up end-to-end for two
  concurrent real FFmpeg/Topaz jobs on the same 2-GPU box (`CGI-Render`),
  now that P4-3H makes concurrent execution possible at all. `gpu_slot`
  is threaded end-to-end (heartbeat response → `AssignedJob` →
  `IJobRunner.Start` → `-gpu N`/`device=N`), unit-tested and confirmed
  against real (single-GPU) hardware. **Not yet done**: the actual
  concurrent-multi-GPU verification — see P4-3H above and
  `docs/PROJECT_STATUS.md`'s Required User Action.
- **P4-7 — Phase 4 close/hardening.** NOT STARTED. Final pass once P4-5/
  P4-6 are both done: re-read every Phase 4 milestone's "Not yet done"/
  "Open item" notes above, resolve or explicitly defer each one, update
  CONTAINERS.md/PROJECT_STATUS.md to a clean "Phase 4 complete" state
  before starting Phase 5.

**Explicitly out of scope for Phase 4**: Houdini/After Effects/Cinema
4D render (Phase 5), Performance Remote (Phase 6), any UI beyond
extending the existing Jobs dashboard (P3-7) to show FFmpeg-specific
job detail if/when needed.

## V2 (document only — do not implement now)

Replace VNC with a higher-performance pipeline for VFX workstation use:

- Windows Graphics Capture / Desktop Duplication API instead of UltraVNC's
  capture.
- GPU encode (NVENC) / AV1 or HEVC instead of VNC's raw/hextile encoding.
- NVDEC-side decode, DirectX-based viewer.
- Low-latency transport tuned for 1440p60 / 4K60 / possibly 120fps.

V2 is a different risk profile (driver-level capture, hardware encode,
custom transport) and should only start after V1 is stable in daily use.

## Future phases (high-level only — not planned in detail, do not start)

User-stated long-term direction (2026-08-16), recorded per the FUTURE
status in [DOCKER_LIFECYCLE.md](DOCKER_LIFECYCLE.md)'s philosophy: note
the phase now, don't build it now. Numbering matches
[MASTER_PROJECT_SPEC.md §44](MASTER_PROJECT_SPEC.md#44-official-roadmap-phase-order)
exactly. This repo's "V1" = Phase 1 below, "Phase 2" (Dreamers Agent) =
Phase 2 below, and Phase 3 (Job Engine) now has its own milestone
breakdown above — V2 (higher-perf capture pipeline, above) is a
separate axis, not one of these phases; it's the technical content of
Phase 6 below, described independently before the master spec existed.

- **Phase 5 — Render Farm** (Houdini, After Effects, Cinema 4D).
- **Phase 6 — Performance Remote** (native GPU-accelerated remote —
  same direction as this file's "V2" section above).
- **Phase 7 — Studio Control Center.**
- **Phase 8 — Dreamers Studio OS Integration.**

None of these have design docs, milestones, or scope breakdowns yet —
that work hasn't started. **Explicitly out of scope for all of them**
until stated otherwise: AI compute/training, browser activity
monitoring.
