# Container Registry

Tracks every Docker container/service running for this project, per the
lifecycle rule in [DOCKER_LIFECYCLE.md](DOCKER_LIFECYCLE.md). Update this
file on every Docker-related change.

| Container | Status | Purpose | Required | Phase | Notes |
|---|---|---|---|---|---|
| `vncgi-remote-server` | PRODUCTION | Backend API (Express) + WebSocket VNC proxy (`/ws/vnc/:id`) + Wake-on-LAN sender + Agent endpoints (`/api/agent/*`) | YES | V1 / Phase 2 | Deployed via Dockge → **Update** (not Deploy — see `PROJECT_STATUS.md`). `network_mode: host` for WOL. |
| `vncgi-remote-web` | PRODUCTION | React/Vite dashboard, served via nginx | YES | V1 | Same Dockge Update caveat as above. |
| `vncgi-remote` | **DEPRECATED (confirmed) — active traffic, do not remove yet** | Standalone M1-era `novnc` proxy, hardcoded to CGI-01 (`VNC_TARGET_HOST=192.29.11.94:5900`), port `6080` | NO (architecturally — superseded by `vncgi-remote-server`'s `wsProxy.ts`) but **something is actively using it** | M1 (obsolete) | **SECURITY GAP**: bypasses the app's session login entirely — anyone on the LAN who knows `http://192.29.11.92:6080` reaches CGI-01's VNC with no `requireAuth` check, unlike `/ws/vnc/:id`. Confirmed via Dockge 2026-08-16: `running`, image `ghcr.io/rajnlove/dreamers-remote-novnc:latest`, real WebSocket connections logged as recently as 15/Aug/2026 12:39. Must identify who/what still connects before stopping — see PROJECT_STATUS.md. |
| `vncgi-remote-93` | **DEPRECATED (confirmed) — active traffic, do not remove yet** | Standalone M1-era `novnc` proxy, hardcoded to COMP-01 (`VNC_TARGET_HOST=192.29.11.93:5900`), external port `6081` | NO (architecturally) but **something is actively using it** | M1 (obsolete) | Same **SECURITY GAP** as `vncgi-remote` — no session auth. Confirmed via Dockge 2026-08-16: `running`, same image, WebSocket traffic as recently as 15/Aug/2026 12:39:30 (seconds apart from `vncgi-remote`'s last hit — looks like the same person/session touched both that day). Also logged 2 requests from `192.168.1.3` — a subnet outside the normal `192.29.11.x` LAN range — that timed out / 404'd; worth checking what that device is. |

## `vncgi-remote` — confirmed 2026-08-16

Opened directly in Dockge. compose.yaml:

```yaml
services:
  novnc:
    restart: unless-stopped
    image: ghcr.io/rajnlove/dreamers-remote-novnc:latest
    ports:
      - 6080:6080
    environment:
      - VNC_TARGET_HOST=192.29.11.94
      - VNC_TARGET_PORT=5900
    networks: {}
```

This is exactly the Milestone 1 proof-of-concept `novnc` service
([novnc.Dockerfile](../docker/novnc.Dockerfile)) — confirms the
hypothesis. **Not architecturally needed**: the current app proxies
`/ws/vnc/:id` through `vncgi-remote-server` itself
(`server/src/remote/wsProxy.ts`), behind session auth. This container
provides a second, unauthenticated path straight to CGI-01's VNC on
port 6080.

**Why it can't just be removed yet**: the Dockge terminal log shows real
`ws://` connections to `/websockify` as recently as 15/Aug/2026 12:39 —
something is still actively using it (a stale bookmark, an old shortcut,
a script — unknown). Per DOCKER_LIFECYCLE.md's cleanup rule, dependency
must be confirmed/ruled out before removal. Next step: identify what's
connecting (check who has a saved link to port 6080, or watch the
Dockge terminal live) and either migrate that usage to the real
dashboard or confirm it's abandoned before stopping this container.

## `vncgi-remote-93` — confirmed 2026-08-16

Opened directly in Dockge. compose.yaml:

```yaml
services:
  novnc:
    restart: unless-stopped
    image: ghcr.io/rajnlove/dreamers-remote-novnc:latest
    ports:
      - 6081:6080
    environment:
      - VNC_TARGET_HOST=192.29.11.93
      - VNC_TARGET_PORT=5900
    networks: {}
```

Same pattern as `vncgi-remote`, just pointed at COMP-01 and mapped to
host port `6081` instead of `6080`. Terminal log shows real `ws://`
connections from `192.29.11.94` (CGI-01's IP — someone at that
workstation reaching COMP-01 through this old direct path) as recently
as 15/Aug/2026 12:39:30, plus two hits from `192.168.1.3` (14/Aug 16:52
timeout, 15/Aug 11:14 → 404) — a subnet that doesn't match any studio
workstation on record (`192.29.11.x`). Source of that IP is unknown;
worth confirming it isn't an external/unexpected access path before
concluding this container is "just an old habit."

**Bottom line for both `vncgi-remote` and `vncgi-remote-93`**: both are
architecturally obsolete (superseded by the real app's authenticated
`/ws/vnc/:id`) but both saw genuine recent traffic. Before stopping
either, per DOCKER_LIFECYCLE.md: confirm who's still using the old
`:6080`/`:6081` URLs (ask around the studio, or watch the Dockge
terminal live for a few days) and get them onto the real dashboard —
then STOP → VERIFY → REMOVE. Removing either while still in active use
would silently break someone's remote access with no warning.
