# Dreamers Agent

Phase 2 subsystem — see [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md#phase-2--dreamers-agent-monitoring--safe-management)
and [../docs/ROADMAP.md](../docs/ROADMAP.md#phase-2--dreamers-agent-monitoring--safe-management)
for the design. Does not modify or replace the UltraVNC/noVNC remote
desktop path — a separate process, separate concern.

## Status: P2-0 through P2-7 complete and live-verified; P2-8 coded, not yet live-verified

- **Metrics collected every `updateIntervalSeconds` (default 5)**: CPU,
  RAM, OS, uptime, GPU (NVIDIA/NVML, multi-GPU), disks, monitored VFX
  process status — all logged locally regardless of server connectivity.
- **Registration + heartbeat**: once paired with the server, the same
  snapshot is sent as a heartbeat; the dashboard shows it live, including
  a per-workstation detail page (P2-7).
- **Restart/Shutdown (P2-8)**: an admin-queued command rides the
  response of whatever heartbeat call comes next (no inbound listener on
  the Agent) and is executed via `AgentCommand`/`CommandExecutor`
  (`Dreamers.Agent.Core/Commands/`) — structured whitelist only
  (`restart`, `shutdown`), never arbitrary shell. Coded and unit-tested,
  but nobody has clicked Restart against a real workstation yet — see
  `docs/PROJECT_STATUS.md` before relying on it.

## Building — only needed on ONE machine, not on every workstation

**The .NET 8 SDK is only required on whichever machine builds/publishes
the agent — never on the target workstations that just run it.** The
Release publish (below) bundles the .NET runtime AND every dependency
into one self-contained `DreamersAgent.exe` — nothing else needed
alongside it, no SDK/runtime to pre-install on the target.

```powershell
# One-time, on the build machine only:
winget install Microsoft.DotNet.SDK.8

cd agent
dotnet build Dreamers.Agent.sln
dotnet test Dreamers.Agent.sln
# Expect: 35 tests passed
```

To see it running locally without installing a service yet:

```powershell
dotnet run --project Dreamers.Agent
```

## Publishing (one file, not a folder)

```powershell
cd agent
dotnet publish Dreamers.Agent -c Release -r win-x64 -o .\dist
```

`.\dist\` will contain exactly one file: **`DreamersAgent.exe`**
(~35MB — self-contained, single-file, no `.pdb`/`.dll`/config files
alongside it; see the `PublishSingleFile`/`DebugType` settings in
`Dreamers.Agent.csproj` if you need to change that). That one file is
everything a recipient needs — send it as-is (Slack, network share,
USB), no zip or folder required.

## Deploying — for a recipient who's never touched a terminal

This is the flow to tell someone with zero technical background: **copy
`DreamersAgent.exe` to the machine and double-click it.** It's the same
one file whether this is that workstation's first install or an update
to an already-running Agent — it looks at what's already on the machine
and does the right thing automatically:

- **Windows will ask for administrator permission (UAC prompt)** — click
  Yes. (Installing/updating/restarting the underlying Windows Service
  needs that either way; this is the only unavoidable click.)
- **If an Agent is already installed** (true for all 4 studio
  workstations as of P2-8): it finds the existing install via the
  Windows Service registry entry, stops the service, replaces the old
  `DreamersAgent.exe` with the new one, restarts it, and reports
  success/failure — no registration needed, the existing credential
  under `C:\ProgramData\DreamersRemote\` is untouched.
- **If nothing is installed yet** (a brand-new workstation): it copies
  itself to `C:\Program Files\DreamersRemote\`, creates the Windows
  Service, and asks — right there in the console window — for a
  registration token. An admin gets that token from the dashboard first
  (`POST /api/workstations/:id/agent-token`, 15-minute single-use — see
  `docs/SECURITY.md`); paste it in when asked, or just press Enter to
  skip and pair it later. Either way the console prints exactly what
  happened and waits for a keypress before closing, so nothing flashes
  by unread.
- **Verify** (optional — the console output already says HOÀN TẤT /
  success, or exactly what to check if not):
  ```powershell
  Get-Service DreamersAgent
  Get-Content C:\ProgramData\DreamersRemote\logs\agent-*.log -Tail 20
  ```
  Within a few seconds the workstation's dashboard card should show a
  green AGENT badge and live metrics.

This double-click path (`Program.cs`'s `HandleInteractiveSetupAsync`) is
**coded, unit-tested indirectly via build/test, but not yet run for
real on a fresh or already-installed machine** — same caveat as P2-8
itself in `docs/PROJECT_STATUS.md`: confirm it end-to-end on one
workstation before trusting it on the rest.

### Scripted / bulk-automation alternative

For automating deployment across many machines (e.g. a remote-exec
tool) rather than a human double-clicking, the same CLI subcommands
from before still work non-interactively:

```powershell
# Fresh install, no interactive prompt:
.\DreamersAgent.exe install <registration-token>
# ...or with no token (pair later):
.\DreamersAgent.exe install

# Already installed — same as the double-click update, scripted:
Stop-Service DreamersAgent
Copy-Item .\DreamersAgent.exe "<existing install path>" -Force
Start-Service DreamersAgent

# Remove entirely:
.\DreamersAgent.exe stop
.\DreamersAgent.exe uninstall
```

All of `install`/`uninstall`/`start`/`stop`/`register` still require
Administrator (the double-click path's UAC prompt covers this
automatically; from a script, run from an elevated session).

## Deploying to multiple workstations (bulk)

P2-9. What's different at N machines instead of one:

- **Publish once, reuse everywhere.** `DreamersAgent.exe` isn't
  workstation-specific — nothing about it identifies which machine it'll
  run on (that identity, the `agentId` UUID, is generated fresh on first
  run into that machine's own `C:\ProgramData\DreamersRemote\agent.json`).
  Publish once, send the same file to every target.
- **One registration token per workstation — never reused.** Tokens are
  single-use and tied to one specific workstation row. There's no
  dashboard button for this yet — it's a raw API call
  (`POST /api/workstations/:id/agent-token`, session-cookie
  authenticated, admin-only). Issue each token right before you're about
  to use it — they're short-lived (15 minutes).
- **Verify each one individually** before moving to the next, rather
  than deploying to all 4 first and checking the dashboard at the end —
  a bad copy or a firewall rule blocking one machine's outbound HTTP is
  much faster to isolate machine-by-machine than after the fact across 4.
- **MAC addresses**: set each workstation's real MAC via
  `PATCH /api/workstations/:id` (`ipconfig /all` on that machine) —
  unrelated to pairing, but easy to do in the same sitting since you're
  already on the machine.

## Config file

`C:\ProgramData\DreamersRemote\agent.json`, created automatically on
first run if missing:

```json
{
  "agentId": "generated-uuid-do-not-edit",
  "serverUrl": "http://192.29.11.92:8080",
  "updateIntervalSeconds": 5
}
```

`agentId` is generated once and must never be edited or deleted (it's
how the server tells this machine apart from any other — see
`SECURITY.md`). `serverUrl` and `updateIntervalSeconds` are safe to
hand-edit; restart the service after changing them. Note: plain
`http://`, not `https://` — the deployed server has no TLS cert
configured (LAN-only V1).

The agent credential (issued at registration) lives separately in
`C:\ProgramData\DreamersRemote\credential.dat`, encrypted at rest via
Windows DPAPI — never edit this file by hand.

The monitored-process list lives in
`C:\ProgramData\DreamersRemote\monitored_processes.json`, also created
with sensible VFX-app defaults on first run; hand-editable.

Phase 4 (P4-2): FFmpeg's allowed source/output roots live in
`C:\ProgramData\DreamersRemote\allowed_paths.json`, created empty on
first run (deny-all until configured):

```json
{
  "allowedRoots": [
    "\\\\192.29.11.92\\Projects"
  ]
}
```

An `ffmpeg` job's `sourcePath`/`outputPath` must fall under one of
these (checked here on the Agent, independently of the server's own
`FFMPEG_ALLOWED_ROOTS` check — defense in depth) or the job fails
immediately with a clear error instead of touching the filesystem.
Hand-editable; restart the service after changing it. This machine
also needs `ffmpeg`/`ffprobe` on `PATH` for the `ffmpeg` capability to
be reported at all — see `WorkerCapabilities`/`FfmpegDetector` in
`Dreamers.Agent.Core`.
