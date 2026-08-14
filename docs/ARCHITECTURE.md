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

Single `docker-compose.yml` with two or three containers
(`dreamers-server`, `dreamers-web`, optionally a `novnc` container — see
[SETUP.md](SETUP.md) for the decision). Deployed on TrueNAS SCALE as a
Custom App / Compose stack, LAN-only, not exposed to the internet.
