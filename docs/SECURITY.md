# Security

Dreamers Remote is built for a trusted studio LAN, not the internet. "LAN
only" is not an excuse to skip basics — it's the reason we can keep the
basics simple.

## Rules enforced in code

- Workstation id is validated (must exist, must be `enabled`) before any
  proxy or wake action.
- The WebSocket VNC proxy only ever connects to an IP/port pulled from the
  workstation database row — the frontend supplies a `workstationId`, never
  a host/IP/port. This prevents the proxy from being abused as an arbitrary
  TCP relay.
- API input is validated (types, ranges, IP/MAC format) before touching the
  database.
- VNC passwords and other secrets come from environment variables or Docker
  secrets, never hardcoded, never committed, never sent to the frontend.
- VNC passwords are never written to logs.
- `.env` is gitignored; `.env.example` documents required keys with no real
  values.
- Basic rate limiting on the API (particularly `/wake` and auth endpoints
  once M6 lands).
- Nothing in this stack is exposed to the internet in V1. No port-forwarding
  guidance is provided or assumed.

## VNC credential handling — tradeoff, documented up front

UltraVNC authentication happens in the RFB protocol, inside the WebSocket
tunnel that websockify/noVNC establishes — not as an HTTP credential. Two
realistic options for V1:

1. **noVNC prompts the user for the VNC password in the browser**, and it
   travels only over the browser<->backend WebSocket (which should be
   TLS/WSS once a cert is set up) and then backend<->UltraVNC over LAN. The
   backend never needs to know the password. Simple, but the user has to
   know/enter a password per workstation (or a shared studio password).
2. **Backend holds the VNC password** (per workstation, from env/DB secret)
   and performs the RFB auth handshake on the client's behalf before handing
   the browser a pre-authenticated tunnel. More convenient (no password
   prompt for users) but means the backend is a secrets store and the attack
   surface for credential theft is the app itself, not just the VNC service.

**V1 default: option 1** (browser prompts for the VNC password via noVNC's
built-in password field) — it's the noVNC-native flow, requires no secret
storage in the backend, and keeps scope small. If the studio wants
single-sign-on-style "click Remote, no password prompt" convenience, that's
option 2 and should be a deliberate follow-up, not a default, since it
changes what the backend needs to protect.

## Phase 2 — Dreamers Agent authentication (design, implemented in P2-5)

The Agent must never be able to claim to be an arbitrary workstation.
Identity is never IP-based (IPs can change/collide) — every Agent has a
persistent `agentId` (UUID, generated once on first run, stored in
`C:\ProgramData\DreamersRemote\agent.json`, never regenerated).

Pairing flow (registration token, one-time use):

1. Admin creates/selects a workstation row in the dashboard.
2. Server issues a short-lived, single-use **registration token** for
   that workstation.
3. Admin enters the token into the Agent once (config file or a small
   CLI prompt during install).
4. Agent calls `/api/agent/register` with the token + its `agentId`.
5. Server validates the token (unused, not expired, matches a
   workstation), pairs `agentId` <-> `workstation.id`, marks the token
   consumed, and issues the Agent a **long-lived agent credential**
   (a random secret, not the registration token) for all future
   heartbeat/command calls.
6. Agent stores the credential locally via **Windows DPAPI**
   (`ProtectedData.Protect`, current-user or local-machine scope
   depending on whether the service runs as `LocalSystem`) — not
   plaintext, not in the repo, not logged.

This mirrors the existing VNC-password philosophy (see below): the
server never stores a workstation's actual Windows admin credentials —
only an opaque agent credential it issued itself, scoped to the
whitelisted command set in [ARCHITECTURE.md](ARCHITECTURE.md).

Agent-facing routes (`/api/agent/*`) are authenticated by this agent
credential, never by the user's session cookie — a compromised Agent
credential should not grant access to `/api/workstations/*` or the VNC
proxy, and vice versa.

## Phase 2 — Agent command execution (P2-8)

Structured whitelist only (`server/src/agent/commands.ts`'s `AGENT_COMMANDS`
— currently `restart`, `shutdown`), never arbitrary shell — mirrored on the
Agent side by `AgentCommandParser`/`CommandExecutor`, which only ever
invoke Windows' own `shutdown.exe` with fixed, known-safe arguments.

The Agent has no inbound listener (matches the pairing model above — it
never accepts unsolicited connections), so a command isn't pushed: an
admin queues it via `POST /api/workstations/:id/command`
(`requireAdmin`-gated), and it's handed to the Agent inside the response
to whatever heartbeat call comes next — same agent-credential
authentication as every other Agent-facing route, no new attack surface.
Every queue/deliver/result transition is recorded in the `command_log`
table (not the general M8 audit log, which doesn't exist yet).

## Explicitly out of scope for V1

- Internet exposure of any kind (app, VNC, or WebSocket proxy).
- Multi-factor auth, SSO/OAuth.
- Encrypting VNC traffic beyond what runs inside the WSS tunnel — UltraVNC
  itself is not internet-hardened and should stay LAN-only.
