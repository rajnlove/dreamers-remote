# Setup

## 1. Windows side — UltraVNC Server

Install on every workstation that should be remoteable.

1. Download and install **UltraVNC** (server component is enough; skip the
   viewer if you want) from the official UltraVNC site on the target
   Windows 11 PC.
2. During/after install, open **UltraVNC Server -> Admin Properties**:
   - **Authentication**: set a **VNC Password** (required — do not run
     without one). Optionally set a separate **View-Only Password** if you
     want a read-only mode later.
   - **Network**: leave the default port **5900** unless you have a reason
     to change it (if you do, record it in that workstation's `vnc_port`
     field — see `config/workstations.example.json`).
   - **MS-Logon**: leave disabled for V1 (adds AD/domain auth complexity we
     don't need yet).
   - Enable **"Accept socket connection"** and make sure the port is not
     restricted to loopback.
3. **Run as a service**: install UltraVNC as a Windows service
   (`winvnc.exe -install` or via the installer's service option) and set it
   to **Automatic** startup, so it's available after reboot without a user
   logged in.
4. **Windows Firewall**: allow inbound TCP on the VNC port (default 5900)
   from the studio LAN subnet. Example (run as Administrator):
   ```powershell
   New-NetFirewallRule -DisplayName "UltraVNC" -Direction Inbound -Protocol TCP -LocalPort 5900 -Action Allow -Profile Private
   ```
5. Confirm the service is listening:
   ```powershell
   Get-Service uvnc_service
   netstat -an | findstr 5900
   ```
6. Note down for this PC: **IP address**, **VNC port**, **VNC password**,
   and **MAC address** (`ipconfig /all`) — needed for the workstation
   registry (M2) and Wake-on-LAN (M5).

## 2. TrueNAS deployment (full app)

- **Dataset**: create an app dataset, e.g.
  `/mnt/<POOL>/apps/dreamers-remote/` (pool name is env-driven, never
  hardcoded — see `.env.example` / `DATA_ROOT`). Subfolders: `db/` (SQLite
  file), `config/` (workstation config, if file-based).
- **Docker volumes**: bind-mount `${DATA_ROOT}/db` into the server
  container at `/data` for the SQLite file.
- **Ports**: web UI on one port, API/WS proxy on another (default `8080`
  — see `docs/PROJECT_STATUS.md` for the live values). Not exposed
  outside the LAN (no port forwarding, no reverse proxy to the internet).
  There is no separate noVNC/websockify container — noVNC's client
  library is bundled into the web app, and the WebSocket-to-VNC proxy
  runs inside the server itself (`server/src/remote/wsProxy.ts`), behind
  the same session login as the rest of the app. (A standalone noVNC
  container existed during Milestone 1 and is now removed — see
  `docs/CONTAINERS.md` if you find one still running somewhere.)
- **Environment variables**: see `.env.example` at repo root — TrueNAS IP,
  data root path, and per-deployment secrets are not committed, only
  documented there as placeholders.
- **Networking**: single Docker bridge network shared by `dreamers-server`
  and `dreamers-web`; the studio LAN is reached via the host's existing
  10GbE interface.
- **Restart policy**: `unless-stopped` on all containers.
- **Backup**: back up the `db/` subfolder of the app dataset with TrueNAS's
  normal dataset snapshot/replication tools — no app-specific backup logic
  in V1.
- **Upgrade**: `docker compose pull && docker compose up -d`; SQLite file
  persists across upgrades since it lives outside the container.

## Known placeholders (fill in when available)

These are not yet known and are represented as env-var placeholders — see
`docs/PROJECT_STATUS.md` for the current list:

- TrueNAS host IP / app port
- TrueNAS pool + dataset path
- First test workstation's IP, VNC port, VNC password, MAC address
