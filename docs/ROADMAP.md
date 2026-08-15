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

## V2 (document only — do not implement now)

Replace VNC with a higher-performance pipeline for VFX workstation use:

- Windows Graphics Capture / Desktop Duplication API instead of UltraVNC's
  capture.
- GPU encode (NVENC) / AV1 or HEVC instead of VNC's raw/hextile encoding.
- NVDEC-side decode, DirectX-based viewer.
- Low-latency transport tuned for 1440p60 / 4K60 / possibly 120fps.

V2 is a different risk profile (driver-level capture, hardware encode,
custom transport) and should only start after V1 is stable in daily use.
