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

- **Phase 4 — Processing** (FFmpeg + Topaz).
- **Phase 5 — Render Farm** (Houdini, After Effects, Cinema 4D).
- **Phase 6 — Performance Remote** (native GPU-accelerated remote —
  same direction as this file's "V2" section above).
- **Phase 7 — Studio Control Center.**
- **Phase 8 — Dreamers Studio OS Integration.**

None of these have design docs, milestones, or scope breakdowns yet —
that work hasn't started. **Explicitly out of scope for all of them**
until stated otherwise: AI compute/training, browser activity
monitoring.
