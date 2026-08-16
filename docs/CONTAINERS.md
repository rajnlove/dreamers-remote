# Container Registry

Tracks every Docker container/service running for this project, per the
lifecycle rule in [DOCKER_LIFECYCLE.md](DOCKER_LIFECYCLE.md). Update this
file on every Docker-related change.

| Container | Status | Purpose | Required | Phase | Notes |
|---|---|---|---|---|---|
| `vncgi-remote-server` | PRODUCTION | Backend API (Express) + WebSocket VNC proxy (`/ws/vnc/:id`) + Wake-on-LAN sender + Agent endpoints (`/api/agent/*`) | YES | V1 / Phase 2 | Deployed via Dockge → **Update** (not Deploy — see `PROJECT_STATUS.md`). `network_mode: host` for WOL. |
| `vncgi-remote-web` | PRODUCTION | React/Vite dashboard, served via nginx | YES | V1 | Same Dockge Update caveat as above. |
| `vncgi-remote` | **DEPRECATED — removal confirmed by user, pending action in Dockge** | Standalone M1-era `novnc` proxy, hardcoded to CGI-01 (`VNC_TARGET_HOST=192.29.11.94:5900`), port `6080` | NO | M1 (obsolete) | User confirmed 2026-08-16 the recent traffic was their own testing, no one else depends on it. Repo-side cleanup (Dockerfile, compose service, CI build target, docs) done same day. **Still running in Dockge** — this agent has no Dockge access to stop/delete it; user needs to click Dừng → Xóa. |
| `vncgi-remote-93` | **DEPRECATED — removal confirmed by user, pending action in Dockge** | Standalone M1-era `novnc` proxy, hardcoded to COMP-01 (`VNC_TARGET_HOST=192.29.11.93:5900`), external port `6081` | NO | M1 (obsolete) | Same as above. The `192.168.1.3` hits noted below were never explained — worth a second look if it recurs after this stack is gone. |

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

This is exactly the Milestone 1 proof-of-concept `novnc` service —
confirms the hypothesis. It used to be
`docker/novnc.Dockerfile`/`docker/novnc-entrypoint.sh` in this repo;
both were removed 2026-08-16 as part of this cleanup, along with the
`novnc` service block in `docker/docker-compose.yml` and the `novnc`
build target in `.github/workflows/docker-build.yml` — none of that
exists in the repo anymore. **Not architecturally needed**: the current
app proxies `/ws/vnc/:id` through `vncgi-remote-server` itself
(`server/src/remote/wsProxy.ts`), behind session auth. This container
provided a second, unauthenticated path straight to CGI-01's VNC on
port 6080.

**Traffic explained**: the Dockge terminal log showed real `ws://`
connections as recently as 15/Aug/2026 12:39 — the user confirmed
2026-08-16 that was their own testing, not another user or an unknown
dependency. Cleared to remove per DOCKER_LIFECYCLE.md's cleanup rule.
**The live Dockge stack itself hasn't been deleted yet** — the repo
cleanup (Dockerfile/compose/CI) doesn't touch what's already running on
TrueNAS; the user still needs to stop and delete this stack in Dockge.

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
connections from `192.29.11.94` (CGI-01's IP) as recently as
15/Aug/2026 12:39:30 — covered by the same user confirmation as
`vncgi-remote` above (their own testing).

One loose end **not** explained by that: two hits from `192.168.1.3`
(14/Aug 16:52 timeout, 15/Aug 11:14 → 404) — a subnet that doesn't match
any studio workstation on record (`192.29.11.x`). Removing this
container removes that access path regardless of what it was, but if
`192.168.1.3` shows up again elsewhere after cleanup, it's worth
tracking down what device that actually is.

**Status**: same as `vncgi-remote` — repo-side cleanup done, cleared to
remove, but the live Dockge stack still needs the user to stop and
delete it directly (no Dockge access from here).
