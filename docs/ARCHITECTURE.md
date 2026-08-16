# Architecture

## Overview

```
                    TRUENAS SCALE

        +----------------------------+
        | Dreamers Remote            |
        |                            |
        | Web UI (React/Vite)        |
        | Backend API (Node/Express) |
        | Workstation Manager        |
        | Wake-on-LAN                |
        | noVNC (static)             |
        | websockify / WS proxy      |
        +-------------+--------------+
                      |
                      | LAN 10GbE
                      |
       +--------------+--------------+
       |              |              |
       v              v              v

    CGI-01          COMP-01         FX-01
  Windows 11       Windows 11      Windows 11
  UltraVNC         UltraVNC        UltraVNC
```

## Remote session flow

```
Browser --WebSocket--> noVNC --> websockify --VNC/RFB--> UltraVNC Server --> Windows Desktop
```

The browser never talks directly to a workstation. It opens a WebSocket to
the backend at `/ws/vnc/:workstationId`. The backend looks up the
workstation's IP/port from the database and proxies to it. The frontend
never supplies a host/IP directly — only an id — so the app can't be turned
into an arbitrary TCP proxy.

## Components

- **web/** — React + Vite + TypeScript dashboard and noVNC viewer page.
- **server/** — Node.js + TypeScript + Express API: workstation CRUD, TCP
  status probing, Wake-on-LAN, and the VNC WebSocket proxy.
- **database/** — SQLite file, schema designed to be portable to PostgreSQL
  later (no SQLite-only types, explicit timestamps, no implicit rowid
  reliance in app code).
- **noVNC / websockify** — off-the-shelf, run as a container (or embedded
  process) in front of each UltraVNC target. Not modified.

## Status detection

TCP connect probe to `ip:vnc_port` with a short timeout (500-1500ms),
instead of ICMP ping (containers often lack raw-socket permission for ICMP).
Backend performs the probe; frontend only ever reads status from the API.

## Data flow for "Remote" button

1. User clicks Remote on a workstation card.
2. Frontend navigates to `/remote/:workstationId`.
3. Page requests a session descriptor from
   `POST /api/workstations/:id/session`.
4. Page opens noVNC pointed at `/ws/vnc/:workstationId` (same-origin, backend
   proxies to the real UltraVNC host).

## Why not implement a custom remote engine in V1

UltraVNC + noVNC + websockify already solve screen capture, input injection,
and browser transport. Building a custom capture/encode pipeline (V2 scope:
Desktop Duplication API, NVENC/AV1, low-latency transport) is a large,
separate effort with different risk profile (driver-level capture, GPU
encode). V1's goal is a working prototype fast; V2 is tracked separately in
[ROADMAP.md](ROADMAP.md).

## Deployment shape

Single `docker-compose.yml` with two containers (`dreamers-server`,
`dreamers-web`). Deployed on TrueNAS SCALE as a Custom App / Compose
stack, LAN-only, not exposed to the internet. (A separate `novnc`
container existed during Milestone 1's proof of concept; removed once
the server took over WS proxying itself — see
[CONTAINERS.md](CONTAINERS.md).)

## Phase 2 — Dreamers Agent (monitoring + safe management)

A second, independent subsystem layered on top of V1 — **does not replace
or modify the VNC remote-desktop path above**. Each Windows workstation
optionally runs `DreamersAgent.exe` as a Windows Service:

```
                  TRUENAS

        Dreamers Remote Server
                 |
                 | HTTPS/WS (metrics, commands)   <- Agent subsystem (new)
                 | -------------------------------
                 | WS (/ws/vnc/:id, unchanged)     <- Remote-desktop path (V1)
      +----------+----------+
      |          |          |
      v          v          v
   COMP-01     CGI-01      FX-01
 Dreamers     Dreamers    Dreamers      <- new
 Agent        Agent       Agent
 UltraVNC     UltraVNC    UltraVNC      <- unchanged
```

- **Agent** (`agent/Dreamers.Agent`, .NET 8 Worker Service): collects
  CPU/RAM/GPU/disk/process metrics locally, sends periodic heartbeats,
  executes a small whitelisted command set (`restart`, `shutdown`, ...).
  Runs independently of UltraVNC — has no knowledge of VNC and never
  touches the RFB/WS proxy path.
- **Server-side**: new `/api/agent/*` routes (register, heartbeat),
  authenticated by a separate agent token (not the user's session
  cookie) — see [SECURITY.md](SECURITY.md) for the token design.
  `workstations` table gains `agent_id`/`last_seen`/`agent_version`/`os`
  columns. Current metrics are cached in memory, not written to SQLite
  on every heartbeat (see `docs/PROJECT_STATUS.md` Phase 2 section for
  why).
- **Online/offline becomes three independent signals**, not one boolean:
  `machineOnline` (reachability), `agentOnline` (heartbeat freshness),
  `vncOnline` (the existing TCP connect probe to `vnc_port`, unchanged).
- **Why this stays a separate subsystem**: so UltraVNC/noVNC can be
  swapped for a different remote-desktop engine later (see V2 in
  [ROADMAP.md](ROADMAP.md)) without touching the Agent, and vice versa —
  monitoring/management must keep working even if the remote-desktop
  transport changes.

## Phase 3 — Dreamers Job Engine (design, in progress)

Started 2026-08-16. Milestone breakdown:
[ROADMAP.md](ROADMAP.md#phase-3--dreamers-job-engine). Full requirements:
[MASTER_PROJECT_SPEC.md §13-16](MASTER_PROJECT_SPEC.md#13-phase-3--dreamers-job-engine-future).
A third subsystem, independent of both the VNC remote-desktop path (V1)
and the Agent monitoring/command path (Phase 2) — reuses the Agent's
existing heartbeat channel for job delivery (same "rides the next
heartbeat, no inbound listener" pattern as P2-8's commands) rather than
opening a new one.

```
                  TRUENAS

        Dreamers Remote Server
                 |
                 |-- WS (/ws/vnc/:id)              <- V1, unchanged
                 |-- HTTPS/WS (metrics, commands)   <- Phase 2, unchanged
                 |-- HTTPS/WS (job assignment,       <- Phase 3, new
                 |   progress, results)
      +----------+----------+
      |          |          |
      v          v          v
   COMP-01     CGI-01      FX-01
 Dreamers     Dreamers    Dreamers
 Agent        Agent       Agent
 (+ Job       (+ Job      (+ Job         <- Agent gains a job-execution
  Worker)      Worker)     Worker)          role, still one process
```

- **Job Engine core** (server-side): queue + scheduler, backed by a new
  `jobs` table (P3-1) alongside the existing `workstations`/`users`
  tables — same SQLite database, no new datastore. Scheduler assigns
  `QUEUED` jobs to workers by capability match (P3-2/P3-3) and, for
  GPU-bound work, by individual GPU slot rather than whole machine
  (MASTER_PROJECT_SPEC.md §3, §19 — a 2-GPU machine is 2 independently
  assignable slots).
- **Worker** = the Agent, extended (not replaced): the same
  `DreamersAgent.exe` that reports metrics and executes restart/shutdown
  now also polls for an assigned job on its heartbeat and executes it
  (P3-4), reporting progress/completion back the same way
  `command-result` already does for P2-8. No second binary, no second
  install.
- **No real job types yet**: Phase 3 proves the engine with a trivial
  built-in `test` job type (sleep + progress). FFmpeg/Topaz (Phase 4)
  and render apps (Phase 5) plug into this same engine as additional job
  types later — Phase 3 doesn't implement or depend on any of them.
- **Why this stays a separate subsystem**: same reasoning as Phase 2 —
  the job engine must keep working regardless of what the remote-desktop
  transport (V1/V2) or the specific processing tools (Phase 4/5) end up
  being. The Agent accumulates roles (metrics, commands, now jobs) but
  the *server-side* subsystems stay decoupled from each other.
