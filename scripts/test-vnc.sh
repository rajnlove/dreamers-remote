#!/usr/bin/env bash
# TCP-connect probe to a workstation's VNC port — the same check the backend
# uses for online/offline status (see docs/ARCHITECTURE.md).
set -euo pipefail

HOST="${1:?usage: test-vnc.sh <ip> [port]}"
PORT="${2:-5900}"

if command -v nc >/dev/null 2>&1; then
  if nc -z -w 2 "$HOST" "$PORT"; then
    echo "ONLINE: $HOST:$PORT is accepting connections"
    exit 0
  else
    echo "OFFLINE: $HOST:$PORT is not reachable"
    exit 1
  fi
else
  echo "nc (netcat) not found — falling back to /dev/tcp" >&2
  if timeout 2 bash -c "cat < /dev/null > /dev/tcp/$HOST/$PORT" 2>/dev/null; then
    echo "ONLINE: $HOST:$PORT is accepting connections"
  else
    echo "OFFLINE: $HOST:$PORT is not reachable"
    exit 1
  fi
fi
