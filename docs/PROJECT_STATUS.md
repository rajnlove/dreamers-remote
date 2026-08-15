# Project Status

Last updated: 2026-08-16

> This file is a **handoff snapshot**, not a changelog — it says where
> things stand and what to do next. Full history (what changed, why,
> what broke and how it got fixed) lives in `git log`; each milestone
> has one commit with a detailed message. Read recent commits if you
> need the story behind a decision, not this file.

## Current state

**V1 (Milestones 1-6) and Phase 2 P2-0 through P2-7 are all complete
and live-verified on real production infrastructure.** The app is
deployed and in daily use. Next unstarted work: **P2-8** (Restart/
Shutdown commands — needs design discussion before coding, see below).

## Live infrastructure — do not guess these, verify if unsure

- **TrueNAS host**: `192.29.11.92`. Dashboard: `http://192.29.11.92:8000`
  (login `admin`/`admin` — **still the throwaway default, should be
  changed**, see "Open items"). API: `http://192.29.11.92:8080`.
  Dockge (container manager): `http://192.29.11.92:31014`.
- **Deploy via Dockge**: click into the stack (`vncgi-remote-server` or
  `vncgi-remote-web`) → **Update** button. **Not "Deploy"** — Deploy
  recreates from whatever image is already cached locally and silently
  skips pulling the new one from GHCR, so a real code change won't
  actually take effect. This has bitten this project before (M6's CORS
  bug shipped this way). Update pulls first, then recreates.
  - GitHub Actions (`.github/workflows/docker-build.yml`) builds+pushes
    `server`/`web`/`novnc` images to GHCR on every push to `main`
    (paths: `server/**`, `web/**`, `docker/**`). Check
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

## The 4 workstations (all agent-paired, all live)

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

## Architecture (V1 + Phase 2)

- **V1**: React/Vite dashboard (`web/`) + Express/TypeScript API
  (`server/`) + SQLite, on TrueNAS via Docker Compose/Dockge. Remote
  desktop = Browser → noVNC → backend WS proxy (`/ws/vnc/:id`) → raw
  TCP → UltraVNC. **Frontend never sends a host/IP to the WS proxy,
  only a `workstationId`** — backend resolves it from the DB. Full
  detail: [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md).
- **Phase 2 (Dreamers Agent)**: `agent/` is a separate .NET 8 Worker
  Service (`DreamersAgent.exe`) per workstation — collects CPU/RAM/GPU
  (NVML, multi-GPU)/disk/VFX-process metrics every 5s, sends heartbeats
  to the server, shown live on the dashboard and a per-workstation
  detail page (`/workstations/:id`). **Completely independent of the
  VNC path** — never touches UltraVNC/noVNC, so either subsystem can
  change without the other caring. Agent auth: token-based one-time
  pairing → long-lived credential, DPAPI-encrypted at rest, sent via
  `X-Agent-Id`/`X-Agent-Credential` headers — separate from the
  session-cookie auth used everywhere else. Design doc:
  [SECURITY.md](SECURITY.md#phase-2--dreamers-agent-authentication-design-implemented-in-p2-5).
  Build/deploy procedure: [agent/README.md](../agent/README.md).

## Key architecture decisions (V1)

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

## Open items

1. **Remote-session latency + multi-monitor tuning — coded, not yet
   live-verified.** User reported VNC feeling laggier than AnyDesk-class
   tools, and multi-monitor workstations getting squashed illegibly
   small (UltraVNC ships the whole virtual desktop as one framebuffer;
   `scaleViewport` was scaling all monitors down to fit one viewport).
   Changes made (2026-08-16), need a real remote session on real
   hardware to confirm they help before considering this done:
   - [wsProxy.ts](../server/src/remote/wsProxy.ts): `TCP_NODELAY` on both
     proxy legs (Nagle's algorithm was holding small interactive
     packets), `perMessageDeflate: false` on the WS server (LAN doesn't
     need compression, it only cost CPU/latency).
   - [RemotePage.tsx](../web/src/pages/RemotePage.tsx): noVNC
     `qualityLevel`/`compressionLevel` tuned for LAN (favor image
     quality, skip zlib work). New toolbar toggle between "fit to
     screen" (current default, scaled) and "100% + drag to pan"
     (`clipViewport`/`dragViewport`) for multi-monitor workstations —
     lets the user work at native resolution instead of a shrunk
     composite.
   - Not done: no UltraVNC-side changes (mirror driver, JPEG quality on
     the server side) — that's per-workstation config, not code: still a
     candidate if latency is still bad after the above.
   - True per-monitor selection (view just one of N monitors) is not
     implemented — RFB/noVNC has no standard mechanism for it; UltraVNC's
     own viewer has a proprietary extension noVNC doesn't speak. Doing
     this properly would mean either reconfiguring UltraVNC to serve one
     monitor, or V2-territory custom capture (Desktop Duplication API
     can target a specific monitor) — out of scope for now.
2. **Wake-on-LAN — on hold, deprioritized by user.** Server-side send is
   verified working (`{"sent": true}`, UDP magic packet actually
   leaves the host), but real hardware (`COMP-01`, `CGI-DUC`) doesn't
   wake. Suspected cause: their NIC (`HPE Ethernet 10Gb 561FLR-T`) may
   not support WOL from a full power-off (S5), or needs a
   HPE-specific BIOS setting (`S5 Wake on LAN`, not generic "Wake on
   PCIe") — not yet confirmed either way. Pick up by checking Device
   Manager → NIC → Advanced tab for a "Wake on Magic Packet" option; if
   it's absent, the card doesn't support it and WOL needs a different
   NIC entirely.
3. **Change the admin password.** `admin`/`admin` was always meant as a
   throwaway first-login credential. No in-app change-password UI
   exists — procedure: update `ADMIN_PASSWORD` in `vncgi-remote-server`'s
   Dockge env vars, then delete the `users` row (or the whole SQLite
   file) so `seedAdminUser` reseeds on next restart.
4. **CPU temperature** — discussed, not implemented. GPU temp works
   great (NVML). CPU temp has no clean Windows API; the reliable option
   (LibreHardwareMonitor-style) needs a kernel-mode driver, which the
   Phase 2 spec explicitly rules out. A WMI-based best-effort read
   (`MSAcpi_ThermalZoneTemperature`) is possible but often returns
   nothing/wrong values depending on BIOS — user hasn't decided whether
   it's worth adding on those terms.
5. **P2-8 (Restart/Shutdown commands) — design decided 2026-08-16, not
   yet coded.** User resolved the three open design questions:
   - **Delivery**: piggyback on the existing heartbeat response (Agent
     already calls out every 5s; server queues a pending command and
     returns it in that response) — no inbound listener on the Agent,
     no new poll endpoint.
   - **Permission**: M7 roles don't exist yet, but restart/shutdown are
     destructive enough to warrant gating ahead of full M7 — add a
     minimal `isAdmin` check now rather than "any logged-in user."
   - **Audit**: don't wait for full M8 audit log — add a small
     `command_log` table scoped to just agent commands (workstation_id,
     command, issued_at, result).
   Still to work out before coding: exact command whitelist beyond
   `restart`/`shutdown`, confirmation-dialog UX, `command_log` column
   list. See `ROADMAP.md` P2-8 and `SECURITY.md`'s command-security
   principles (structured commands only, never arbitrary shell).
6. **P2-9 (bulk agent deployment docs)** — largely done in practice
   (this session deployed to all 4 machines), but not yet written up
   as a repeatable doc beyond `agent/README.md`.

## Important commands

```bash
# Server (needs Node — not available on this machine as of this
# writing; CI is the real build gate)
cd server && npm install && npm run typecheck && npm test && npm run dev

# Agent (needs .NET 8 SDK — IS available on this machine)
cd agent
dotnet build Dreamers.Agent.sln
dotnet test Dreamers.Agent.sln
dotnet publish Dreamers.Agent -c Release -r win-x64 --self-contained true -o .\dist
# ^ self-contained: target workstations need NO .NET installed, just
# copy the dist/ folder over and run DreamersAgent.exe there.

# Register + install an agent on a workstation (from an elevated
# PowerShell, on that workstation, after an admin issues a token via
# POST /api/workstations/:id/agent-token from the dashboard):
.\DreamersAgent.exe install <registration-token>
```

## Info still needed from user (do not guess)

- TrueNAS pool name + dataset path, if/when SQLite data should move off
  Dockge's default bind-mount (`./data`) onto a proper named dataset —
  candidates seen: `pool_cgivn_share`, `pool_cgivn_work`. Nothing
  currently depends on this.
