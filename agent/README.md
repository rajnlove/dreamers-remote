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
the agent — never on the target workstations that just run it.** A
`--self-contained` publish (below) bundles the .NET runtime into the
output folder, so a target workstation needs nothing pre-installed: no
SDK, no separate .NET Runtime, nothing. Copy the published folder over
and run the `.exe` directly.

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

## Deploying to a workstation

**1. Publish once, on the build machine** (adjust `-r` if not x64):

```powershell
cd agent
dotnet publish Dreamers.Agent -c Release -r win-x64 --self-contained true -o .\publish
```

This produces a self-contained `publish\` folder (`DreamersAgent.exe` +
its dependencies, no SDK/runtime needed to run it elsewhere).

**2. Copy the whole `publish\` folder** to the target workstation —
network share, USB, whatever's convenient. The target machine does not
need .NET installed at all.

**3. On the dashboard**, an admin issues a registration token for that
workstation: `POST /api/workstations/:id/agent-token` (15-minute,
single-use — see `docs/SECURITY.md`).

**4. On the target workstation**, from an elevated (Administrator)
PowerShell, inside the copied `publish\` folder:

```powershell
.\DreamersAgent.exe install <registration-token>
```

This single command creates the Windows Service, registers with the
server using the token, and starts it. (Installing with no token also
works — the service comes up and logs metrics locally, just doesn't
send heartbeats until you separately run `.\DreamersAgent.exe register
<token>` and restart it.)

**5. Verify**:

```powershell
Get-Service DreamersAgent
Get-Content C:\ProgramData\DreamersRemote\logs\agent-*.log -Tail 20
```

`Get-Service` should show `Running`. Within a few seconds the
workstation's dashboard card should show a green AGENT badge and live
metrics.

## Updating an already-installed Agent

Different from "Deploying to a workstation" above — that flow is for
pairing a workstation for the first time (fresh registration token). If
the service is already installed and paired (all 4 studio workstations
are, as of P2-8), replace the binaries in place instead:

```powershell
# 1. Find where it's currently installed, and stop it:
(Get-CimInstance Win32_Service -Filter "Name='DreamersAgent'").PathName
Stop-Service DreamersAgent

# 2. Extract the new build's files into that same directory, overwriting
#    the old ones. Config (agent.json) and the DPAPI-encrypted credential
#    (credential.dat) live separately under C:\ProgramData\DreamersRemote\
#    — untouched by this, so there's no need to re-pair.

# 3. Restart:
Start-Service DreamersAgent
Get-Content C:\ProgramData\DreamersRemote\logs\agent-*.log -Tail 20
```

No registration token needed — the existing credential is still valid.

## Deploying to multiple workstations (bulk)

P2-9. What actually worked deploying to all 4 studio workstations this
session — the single-workstation steps above still apply per machine,
this just covers what's different at N machines instead of one:

- **Publish once, reuse everywhere.** The `publish\` folder from step 1
  isn't workstation-specific — nothing about it identifies which machine
  it'll run on (that identity, the `agentId` UUID, is generated fresh by
  each install, on first run, into that machine's own
  `C:\ProgramData\DreamersRemote\agent.json`). Publish once, copy the
  same folder to every target (network share is easiest on a studio LAN)
  — no per-workstation rebuild.
- **One registration token per workstation — never reused.** Tokens are
  single-use and tied to one specific workstation row
  (`POST /api/workstations/:id/agent-token`), so step 3 repeats for each
  machine. There's no dashboard button for this yet — it's a raw API
  call (session-cookie authenticated, admin-only). Issue each token
  right before you're about to use it on that machine — they're
  short-lived (15 minutes).
- **Install command is identical across machines** —
  `.\DreamersAgent.exe install <token>` — only the token argument
  changes per workstation.
- **Verify each one individually** (step 5) before moving to the next,
  rather than installing on all 4 first and checking the dashboard at
  the end — a bad copy or a firewall rule blocking one machine's
  outbound HTTP is much faster to isolate machine-by-machine than after
  the fact across 4.
- **MAC addresses**: set each workstation's real MAC via
  `PATCH /api/workstations/:id` (`ipconfig /all` on that machine) before
  or after Agent install — unrelated to pairing, but easy to do in the
  same sitting since you're already on the machine.

**To remove**:

```powershell
.\DreamersAgent.exe stop
.\DreamersAgent.exe uninstall
```

`install`/`uninstall`/`start`/`stop`/`register` all require
Administrator except `register` on its own (creating/starting/stopping
a Windows Service always needs elevation; registering is just an HTTP
call + writing a DPAPI-protected file, but `install` already needs
elevation anyway so doing both in one elevated command is simplest).

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
