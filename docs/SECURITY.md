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

## Explicitly out of scope for V1

- Internet exposure of any kind (app, VNC, or WebSocket proxy).
- Multi-factor auth, SSO/OAuth.
- Encrypting VNC traffic beyond what runs inside the WSS tunnel — UltraVNC
  itself is not internet-hardened and should stay LAN-only.
