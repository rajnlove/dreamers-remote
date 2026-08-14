#!/usr/bin/env bash
# Check whether a host responds on the network at all (TCP connect to port 445/135
# as a rough "is it up" check — not a substitute for the VNC-port probe the app uses).
set -euo pipefail

HOST="${1:?usage: test-host.sh <ip>}"

if command -v nc >/dev/null 2>&1; then
  if nc -z -w 2 "$HOST" 445 2>/dev/null || nc -z -w 2 "$HOST" 135 2>/dev/null; then
    echo "UP: $HOST responds on 445 or 135"
    exit 0
  else
    echo "DOWN or unreachable: $HOST"
    exit 1
  fi
else
  echo "nc (netcat) not found — falling back to ping" >&2
  ping -c 1 -W 2 "$HOST" && echo "UP: $HOST responds to ping"
fi
