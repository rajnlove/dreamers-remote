#!/bin/sh
# Serves noVNC's static UI and proxies its WebSocket to a single UltraVNC
# target defined by VNC_TARGET_HOST / VNC_TARGET_PORT. Milestone 1 only —
# a single fixed target, no per-workstation routing (that's the backend's
# job from Milestone 2 onward, see docs/ARCHITECTURE.md).
set -eu

: "${VNC_TARGET_HOST:?VNC_TARGET_HOST is required}"
: "${VNC_TARGET_PORT:?VNC_TARGET_PORT is required}"

exec websockify --web=/opt/novnc "${NOVNC_LISTEN_PORT:-6080}" "${VNC_TARGET_HOST}:${VNC_TARGET_PORT}"
