# Dreamers Remote

Internal remote-desktop system for the studio LAN. Lets staff see which Windows
workstations are online and remote into them from a browser, backed by
UltraVNC + noVNC. Runs on TrueNAS SCALE via Docker Compose.

- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Current status / next task: [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)
- Roadmap (V1 milestones + V2 ideas): [docs/ROADMAP.md](docs/ROADMAP.md)
- Security model & tradeoffs: [docs/SECURITY.md](docs/SECURITY.md)
- Setup / deployment: [docs/SETUP.md](docs/SETUP.md)

## Quick start (Milestone 1 — VNC proof of concept)

```bash
cp .env.example .env
# edit .env: set VNC_TARGET_HOST/VNC_TARGET_PORT to your first test workstation
docker compose --project-directory . -f docker/docker-compose.yml up -d novnc
```

Then open `http://<truenas-ip>:6080/vnc.html` and connect.

See [docs/SETUP.md](docs/SETUP.md) for UltraVNC configuration on the Windows side.
