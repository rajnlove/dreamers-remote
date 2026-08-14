#!/usr/bin/env bash
# Send a Wake-on-LAN magic packet. Manual/standalone version of what the
# backend's /api/workstations/:id/wake endpoint does (see docs/ARCHITECTURE.md).
set -euo pipefail

MAC="${1:?usage: wake-host.sh <mac-address> [broadcast-ip]}"
BCAST="${2:-255.255.255.255}"
PORT=9

if command -v wakeonlan >/dev/null 2>&1; then
  wakeonlan -i "$BCAST" "$MAC"
  exit 0
fi

# Fallback: build the magic packet (6x FF + 16x target MAC) and send via /dev/udp.
hex="${MAC//[:-]/}"
if [[ ! "$hex" =~ ^[0-9A-Fa-f]{12}$ ]]; then
  echo "Invalid MAC address: $MAC" >&2
  exit 1
fi

packet=$(printf 'f%.0s' {1..12})
for _ in {1..16}; do packet+="$hex"; done

python3 - "$BCAST" "$PORT" "$packet" <<'PY'
import socket, sys, binascii
bcast, port, hexpacket = sys.argv[1], int(sys.argv[2]), sys.argv[3]
data = binascii.unhexlify(hexpacket)
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
s.sendto(data, (bcast, port))
print(f"Magic packet sent to {bcast}:{port}")
PY
