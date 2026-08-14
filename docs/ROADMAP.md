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

## V2 (document only — do not implement now)

Replace VNC with a higher-performance pipeline for VFX workstation use:

- Windows Graphics Capture / Desktop Duplication API instead of UltraVNC's
  capture.
- GPU encode (NVENC) / AV1 or HEVC instead of VNC's raw/hextile encoding.
- NVDEC-side decode, DirectX-based viewer.
- Low-latency transport tuned for 1440p60 / 4K60 / possibly 120fps.

V2 is a different risk profile (driver-level capture, hardware encode,
custom transport) and should only start after V1 is stable in daily use.
