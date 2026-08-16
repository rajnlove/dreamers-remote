# Dreamers Remote / Studio Compute — Master Project Specification

Recorded 2026-08-16, as given by the project owner. This is the
long-term vision and architecture direction for the whole system —
**not a build plan**. Only Phase 1 (Web Remote) and Phase 2 (Dreamers
Agent) are implemented; everything else here is FUTURE per
[DOCKER_LIFECYCLE.md](DOCKER_LIFECYCLE.md)'s status philosophy — noted
now, not built now. See [ROADMAP.md](ROADMAP.md) for milestone-level
detail on what's actually in progress, and
[PROJECT_STATUS.md](PROJECT_STATUS.md) for current state.

**Do not implement anything from Phase 3 onward unless explicitly
requested.** Follow the current milestone only (see PROJECT_STATUS.md).

## 1. Overall goal

An internal studio system with TrueNAS as the coordination hub and
Windows workstations as processing nodes. The system must eventually
serve:

- Remote Desktop
- Workstation Monitoring
- Machine Management
- Job Queue / Scheduler
- FFmpeg / Topaz Processing
- Render Farm
- Studio Control Center
- Dreamers Studio OS Integration

**Explicitly out of scope for now**: AI training/inference, browser
activity monitoring.

## 2. Current infrastructure — TrueNAS

- TrueNAS SCALE, dual Xeon E5-2696 v3, 128GB ECC RAM, 10GbE, **no
  dedicated GPU**.
- Role: PHP web server, database, storage, Docker apps, Dreamers Remote
  server, job queue, scheduler, shared project storage, logs,
  configuration.
- **TrueNAS is not a processing node.** Do not prioritize running heavy
  CPU FFmpeg encode, Topaz, GPU render, or AI processing on it.

## 3. Current workstations

| # | CPU | RAM | GPU | OS | Network | Intended role |
|---|---|---|---|---|---|---|
| 1 | Intel Core i9-14900K | 128GB DDR5 | RTX 5090 | Win 11 | 10GbE | Primary workstation, high-performance processing, FFmpeg NVENC, Topaz, render worker, Performance Remote host/client |
| 2 | AMD Ryzen 9 | 192GB DDR5 | RTX 5070 | Win 11 | 10GbE | General workstation, processing worker, render worker, RAM-heavy workloads |
| 3 | Intel Core i9-13900K | 128GB | RTX 5070 | Win 11 | 10GbE | General workstation, processing worker, render worker, backup worker |
| 4 | Intel Core i9-9900X (X299) | 128GB | 2x RTX 3090 | Win 11 | 10GbE | Multi-GPU worker, background processing, render worker, potential dedicated worker |

**Important**: 1 machine != 1 GPU worker slot. Machine 4 must be modeled
as two independent GPU slots under one host:

```
Machine 4
├── GPU Slot 0 → RTX 3090
└── GPU Slot 1 → RTX 3090
```

Architecture must support multi-GPU machines from the start, not as a
later retrofit.

(Note: these 4 role descriptions are the long-term vision. The 4
workstations actually paired with Dreamers Agent today —see
PROJECT_STATUS.md's "Active Workers" table— are different physical
machines serving the current V1/Phase 2 scope, not yet assigned these
future GPU-slot/worker roles.)

## 4. Overall architecture

```
                         TRUENAS

              Dreamers Control Server
        ┌────────────────────────────────┐
        │ Web UI                         │
        │ API                            │
        │ Authentication                 │
        │ Workstation Database           │
        │ Job Queue                      │
        │ Scheduler                      │
        │ Remote Session Control         │
        │ Logs                           │
        │ Shared Storage                 │
        └───────────────┬────────────────┘
                        │
                      10GbE
             ┌──────────┼──────────┐
             │          │          │
             ▼          ▼          ▼

          Machine 1   Machine 2   Machine 3
             │          │          │
          Agent      Agent       Agent

                        │
                        ▼
                    Machine 4
                       │
                     Agent
                  ┌────┴────┐
                GPU0       GPU1
```

## 5. Phase 1 — Web Remote (implemented)

```
Windows → UltraVNC Server → VNC/RFB → websockify → noVNC → Browser
```

Goal: admin access, quick support, restart/check a machine, basic
remote usage, emergency access. **Not expected to match DeskIn-level
smoothness.** UltraVNC/noVNC must be kept even after Performance Remote
(Phase 6) exists — every workstation will eventually offer both
`[ WEB REMOTE ]` and `[ PERFORMANCE REMOTE ]`.

## 6. Phase 2 — Dreamers Agent (implemented)

Every Windows workstation runs `DreamersAgent.exe` — C#, .NET 8,
Windows Service. Must run in background, auto-start, auto-reconnect, be
lightweight, resilient, and never interfere with VFX work.

## 7. Agent identity

Not IP-based. Each Agent has `agent_id` (UUID), hostname, machine name,
agent version — stored at `C:\ProgramData\DreamersRemote\`, generated
once, never regenerated on boot.

## 8. Agent monitoring

- **CPU**: model, cores, logical processors, usage %.
- **RAM**: total, used, available, usage %.
- **GPU** (array, `gpus[]`): index, name, utilization, VRAM total/used,
  temperature. Prefer NVIDIA NVML; must not crash if NVML unavailable.
- **Storage**: per-disk total/used/free/usage %.
- **System**: hostname, OS, OS version, uptime, active IP, network
  adapter, agent version.

## 9. Process monitoring

Priority apps: `AfterFX.exe`, `Cinema4D.exe`, `houdini.exe`,
`houdinifx.exe`, `hbatch.exe`, `hython.exe`, `Nuke*.exe`, `maya.exe`,
`3dsmax.exe`, `blender.exe`. Not hardcoded — configurable process
definitions. Report running/stopped, PID, RAM usage, start time.

## 10. Machine status

Not a single boolean. Distinguish `machineOnline`, `agentOnline`,
`vncOnline` independently (e.g. Machine online, Agent online, UltraVNC
offline is a valid, distinct state).

## 11. Workstation availability (future — Job Engine dependency)

The scheduler must not assign a job just because a machine is Online.
Machines need a state: `AVAILABLE`, `BUSY`, `DISABLED`,
`DEDICATED_WORKER`, `INTERACTIVE`. Configurable thresholds (GPU/RAM/CPU
usage, artist actively using the machine, manual disable) prevent new
job assignment.

## 12. Agent commands (P2-8 implemented; scope may grow later)

Structured commands only: `restart`, `shutdown`, `lock`, `restart_vnc`.
Never arbitrary PowerShell/CMD/remote shell injection. Server must
authenticate, authorize, and audit; Agent must validate the command.
(Today's implementation: `restart`/`shutdown` only — see
`server/src/agent/commands.ts` and SECURITY.md.)

## 13. Phase 3 — Dreamers Job Engine (future)

One shared foundation for Processing + Render — not a separate queue
per application.

```
                 DREAMERS JOB ENGINE

                       Queue
                         │
                     Scheduler
                         │
           ┌─────────────┼─────────────┐
           │             │             │
        FFmpeg         Render        Future
           │
        Topaz
```

Core must support: queue, priority, scheduling, worker selection, GPU
slot selection, progress, retry, failure handling, cancel, pause,
resume, logs, dependency, capability matching.

## 14. Job data model (future)

Minimum fields: `id`, `type`, `status`, `priority`, `created_at`,
`started_at`, `finished_at`, `worker_id`, `gpu_slot`, `progress`,
`input`, `output`, `error`, `retry_count`.

Status: `QUEUED`, `ASSIGNED`, `RUNNING`, `PAUSED`, `COMPLETED`,
`FAILED`, `CANCELLED`.

## 15. Worker capability (future)

Each workstation reports capability (FFmpeg, Topaz, Houdini, Karma,
Cinema 4D, Octane, After Effects — yes/no per software). Scheduler only
assigns jobs on a capability match.

## 16. Software version compatibility (future)

Agent must be able to report installed versions (Houdini, Cinema 4D,
After Effects, Octane, plugin versions, FFmpeg, Topaz). Scheduler must
not assign a job to an incompatible version (e.g. job requires Houdini
21.0.729; a worker on 20.5.684 is incompatible).

## 17. Phase 4 — FFmpeg processing (future)

TrueNAS does not encode directly:

```
User Upload → TrueNAS Storage → PHP creates Job → Dreamers Job Queue
→ Windows Worker → FFmpeg NVENC → Result → TrueNAS
```

PHP does not block waiting for FFmpeg to finish.

## 18. FFmpeg worker (future)

Prefer GPU encode: H.264 NVENC, HEVC NVENC, AV1 NVENC where applicable.
Workloads: video compression, proxy generation, web preview, thumbnail,
transcode, delivery encode.

## 19. Multi-GPU processing (future)

Do not assume multiple GPUs combine to speed up one file's encode.
Prefer independent assignment: RTX 3090 #0 → Job A, RTX 3090 #1 → Job
B. Scheduler must manage **GPU slot**, not just machine.

## 20. Topaz processing (future)

```
TrueNAS → Job Queue → Worker → Topaz → NAS output
```

Topaz integration is its own worker type — do not hardcode its UI logic
into the scheduler.

## 21. Phase 5 — Render Farm (future)

Must support at least Houdini, After Effects, Cinema 4D.

## 22. Houdini render (future)

May use Houdini CLI, hbatch, hython, Karma, PDG/TOPs, HQueue
integration where appropriate. Animation renders should be
frame-chunked (e.g. 1001–1200) and scheduled dynamically — whichever
machine finishes first picks up the next frame, not a fixed hard block
per machine, when dynamic scheduling is more efficient.

## 23. Houdini simulation (future)

Different from independent frame render — do not assume every
simulation can be freely frame-chunked. Needs dependency support, cache
stages, PDG jobs, simulation sequencing. Only implement when a concrete
workflow requires it.

## 24. After Effects render (future)

Use `aerender.exe`. Prefer EXR/PNG/TIFF sequence output. Do not let
multiple machines encode directly to one MP4 — after the frame sequence
completes: `Image Sequence → FFmpeg Worker → Final video`.

## 25. Cinema 4D render (future)

May use Cinema 4D command line, Team Render, or renderer-specific
command tools. Architecture must not depend entirely on Team Render —
Dreamers Job Engine remains the primary coordination layer.

## 26. Octane (future)

If using Cinema 4D + Octane, the scheduler must check: Octane
installed, plugin version, GPU support, license availability. Do not
assume every workstation can render Octane.

## 27. Shared project storage (future)

Projects/assets must live on TrueNAS at a consistent path across
workers, e.g. `\\TRUENAS\Projects\Movie01\` with subfolders `houdini/`,
`c4d/`, `aftereffects/`, `footage/`, `textures/`, `cache/`, `render/`,
`output/`. Avoid per-machine inconsistent local paths
(`Machine 1 → D:\Project`, `Machine 2 → E:\Project`, ...) for anything
that needs to be shared across jobs.

## 28. Phase 6 — Performance Remote (future)

Web Remote (Phase 1) isn't smooth enough for interactive VFX work.
Performance Remote must be its own engine — **do not modify UltraVNC to
try to turn it into DeskIn.**

```
HOST WINDOWS
    ↓
Windows Graphics Capture
    ↓
NVENC
    ↓
HEVC / AV1
    ↓
Direct LAN
    ↓
NVDEC
    ↓
DirectX Native Viewer
```

TrueNAS's role stays limited to: authentication, permission, machine
discovery, session negotiation, audit. Do not relay video through
TrueNAS unless unavoidable. (This is the same V2 direction already
noted in ROADMAP.md — do not implement now; V1 stays on UltraVNC/noVNC.)

## 29. Performance Remote development targets (future, staged)

Do not jump straight to 4K120. In order:

1. **Stage 1**: 1080p, 60fps, HEVC, hardware encode/decode, direct LAN,
   keyboard, mouse.
2. **Stage 2**: 1440p, 60fps.
3. **Stage 3**: 4K, 60fps.
4. **Stage 4**: AV1, 120fps experiment, multi-monitor, audio, clipboard,
   higher color quality.

## 30. Performance profiles (future)

- **Interactive**: low latency, 60–120fps, 1080p/1440p, moderate
  bitrate. For Houdini viewport, Cinema 4D, After Effects, Nuke.
- **Quality**: 1440p/4K, 60fps, higher bitrate, better chroma/color. For
  image evaluation.

## 31. Phase 7 — Studio Control Center (future)

Once subsystems are stable, one master dashboard: WORKSTATIONS, REMOTE,
PROCESSING, RENDER FARM, JOBS, ALERTS, LOGS. Example summary shape:
"8 Workstations — Online: 7, Offline: 1 — Available Workers: 4, Busy
Workers: 2 — Render Jobs: 3, Processing Jobs: 4, Failed Jobs: 1."

## 32. Workstation groups (future)

Support tags: `COMP`, `FX`, `CGI`, `RENDER`, `GENERAL`. A machine can
have multiple tags (e.g. Machine 4: `RENDER`, `MULTI_GPU`,
`BACKGROUND_WORKER`).

## 33. Alerts (future)

Support: machine offline, agent offline, GPU temperature high, RAM
high, disk full, job failed, render failed, worker lost. Must debounce/
cooldown — do not spam an alert every polling cycle.

## 34. Audit log (future — V1's M8 is the seed of this)

Log: login, remote started/ended, wake, restart, shutdown, job
created/cancelled/retried, worker enabled/disabled, configuration
change. **Never log**: passwords, VNC password, keyboard input,
clipboard content, secrets.

## 35–37. Docker lifecycle policy

Already adopted — see [DOCKER_LIFECYCLE.md](DOCKER_LIFECYCLE.md) and
[CONTAINERS.md](CONTAINERS.md). Every container needs status
(PRODUCTION/TEST/TEMPORARY/FUTURE/DEPRECATED), purpose, image, ports,
volumes, required, phase, owner, cleanup condition, notes recorded in
CONTAINERS.md. Never run `docker system prune -a` on the TrueNAS
production host. Verify dependency/volumes/rollback/future-need before
removing anything; promote or remove test containers once testing is
done — never leave an orphan undocumented.

(`vncgi-remote`/`vncgi-remote-93` audit: see CONTAINERS.md —
DEPRECATED, removal confirmed by the user 2026-08-16, pending the
actual Dockge deletion.)

## 38. Documentation structure

```
docs/
├── MASTER_PROJECT_SPEC.md   (this file)
├── PROJECT_STATUS.md
├── ARCHITECTURE.md
├── CONTAINERS.md
├── DOCKER_LIFECYCLE.md
├── SECURITY.md
├── ROADMAP.md
└── SETUP.md
```

## 39. CLAUDE.md

Must stay short — not a project history. Core content: read
MASTER_PROJECT_SPEC.md / PROJECT_STATUS.md / CONTAINERS.md before
architectural or implementation work; follow the current milestone
only; do not implement future phases unless explicitly requested;
update PROJECT_STATUS.md after milestone completion.

## 40. PROJECT_STATUS.md

Must always contain: Current Phase, Current Milestone, Completed, In
Progress, Known Issues, Next Task, Tests Performed, Required User
Action, Docker Status, Active Workers, Architecture Decisions. Not a
long history — git commits hold detailed history.

## 41. Development rule

Do not code multiple phases at once. Workflow: Implement → Build → Test
→ Fix → Verify → Update documentation → Commit → Next milestone. Do not
skip past an error to move on to another feature.

## 42. Security

Even as an internal system: authenticate users, authorize commands,
validate input, protect agent credentials, protect VNC credentials,
limit worker commands, log admin actions. Do not create an arbitrary
TCP proxy. Do not expose any service to the internet at this stage.

## 43. Scope

**In scope** (across all phases, present and future): Remote, Agent,
Monitoring, Machine Management, Job Engine, FFmpeg, Topaz, Render Farm,
Houdini, After Effects, Cinema 4D, Performance Remote, Studio Control
Center, Studio OS Integration.

**Out of scope**: AI training, AI inference farm, browser
history/website tracking, keystroke logging, internet remote relay,
mobile app, Kubernetes, enterprise microservices.

## 44. Official roadmap (phase order)

```
PHASE 1 — Web Remote (UltraVNC + noVNC)                    [done]
    ↓
PHASE 2 — Dreamers Agent (Monitoring, Machine Management)  [in progress: P2-8]
    ↓
PHASE 3 — Dreamers Job Engine (Queue, Scheduler, Worker, GPU Slots)
    ↓
PHASE 4 — Processing (FFmpeg, Topaz)
    ↓
PHASE 5 — Render Farm (Houdini, After Effects, Cinema 4D, Octane where applicable)
    ↓
PHASE 6 — Performance Remote (native GPU-accelerated remote)
    ↓
PHASE 7 — Studio Control Center
    ↓
PHASE 8 — Dreamers Studio OS Integration
```

(This repo's `ROADMAP.md` "V2" section = the technical content of Phase
6 above, described independently before this master spec existed —
same direction, not a separate track.)

## 45. Final principles

Priority order: **Working system > Stability > Maintainability >
Performance > Extra features.**

- Do not over-engineer.
- Do not create a service unless needed.
- Do not create a test Docker container and forget about it.
- Do not implement features outside the current milestone on your own
  initiative.
- Every new piece of architecture must stay compatible with: **TrueNAS
  = Control + Storage; Windows Workstations = Compute + Render + Encode
  + Remote Host.**
