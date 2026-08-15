# Dreamers Agent

Phase 2 subsystem — see [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md#phase-2--dreamers-agent-monitoring--safe-management)
and [../docs/ROADMAP.md](../docs/ROADMAP.md#phase-2--dreamers-agent-monitoring--safe-management)
for the design. Does not modify or replace the UltraVNC/noVNC remote
desktop path — a separate process, separate concern.

## Current milestone: P2-1 (skeleton)

What exists right now:

- `Dreamers.Agent.Core` — `AgentConfig`/`AgentConfigStore` (identity +
  config persistence), `RollingFileLogger*` (daily-rotating file logger,
  14-day retention).
- `Dreamers.Agent` — the actual Worker Service (`DreamersAgent.exe`).
  `Program.cs` handles `install`/`uninstall`/`start`/`stop` as thin
  wrappers around `sc.exe`, otherwise builds and runs the service host.
  `Worker.cs` just ticks on `UpdateIntervalSeconds` and logs — no
  metrics collection yet (that's P2-2+).
- `Dreamers.Agent.Tests` — unit tests for config persistence and the
  file logger.

No system metrics, no GPU monitoring, no server communication, no
commands yet — those are later milestones (P2-2 through P2-9 in
`ROADMAP.md`).

## Build / test — this code has NOT been build-verified yet

This code was written on a machine without the .NET SDK installed, so it
has not been compiled or run. Follow this exact procedure on a machine
with the .NET 8 SDK to verify it, and report back anything that doesn't
match:

```powershell
# 1. Install the SDK if not already present (run yourself — the agent
#    building this code does not install software on your machine):
winget install Microsoft.DotNet.SDK.8

# 2. From the repo root:
cd agent
dotnet build Dreamers.Agent.sln

# 3. Run the unit tests:
dotnet test Dreamers.Agent.sln
# Expect: 6 tests passed (4 in AgentConfigStoreTests, 2 in RollingFileLoggerTests)

# 4. Run the agent interactively (not installed as a service yet) to
#    confirm it starts, logs to console AND to a file, and picks up config:
dotnet run --project Dreamers.Agent
# Expect console output like:
#   info: Dreamers.Agent.Worker[0]
#         Dreamers Agent starting. AgentId=<uuid> ServerUrl=https://192.29.11.92:8080 IntervalSeconds=5
# Ctrl+C to stop. Then check:
#   type C:\ProgramData\DreamersRemote\agent.json
#   type C:\ProgramData\DreamersRemote\logs\agent-<today's date, yyyyMMdd>.log
# agent.json should have a real GUID as agentId. Run it again — agentId
# must be the SAME value (persistence, not regenerated).
```

## Install as a Windows Service (once the above all checks out)

```powershell
# Publish a self-contained build (adjust RID if not x64):
dotnet publish Dreamers.Agent -c Release -r win-x64 --self-contained true -o .\publish

# Copy .\publish\DreamersAgent.exe (+ its output folder) to the target
# workstation, then from an elevated (Administrator) PowerShell there:
.\DreamersAgent.exe install
.\DreamersAgent.exe start

# Verify:
Get-Service DreamersAgent
Get-Content C:\ProgramData\DreamersRemote\logs\agent-*.log -Tail 20

# To remove:
.\DreamersAgent.exe stop
.\DreamersAgent.exe uninstall
```

`install`/`start`/`stop`/`uninstall` require Administrator (creating/
starting/stopping a Windows Service always does, regardless of this
app) — running them from a non-elevated prompt will fail with an access
denied error from `sc.exe`.

## Config file

`C:\ProgramData\DreamersRemote\agent.json`, created automatically on
first run if missing:

```json
{
  "agentId": "generated-uuid-do-not-edit",
  "serverUrl": "https://192.29.11.92:8080",
  "updateIntervalSeconds": 5
}
```

`agentId` is generated once and must never be edited or deleted (it's
how the server tells this machine apart from any other — see
`SECURITY.md`). `serverUrl` and `updateIntervalSeconds` are safe to
hand-edit; restart the service after changing them.
