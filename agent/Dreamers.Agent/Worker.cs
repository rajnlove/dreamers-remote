using Dreamers.Agent.Core.Commands;
using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Credentials;
using Dreamers.Agent.Core.Jobs;
using Dreamers.Agent.Core.Metrics;
using Dreamers.Agent.Core.Server;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Dreamers.Agent;

/// <summary>
/// Collects and logs CPU/RAM/OS/uptime/GPU/disk/apps on each tick
/// (P2-2/P2-3/P2-4), and — if this workstation has been registered with
/// the server (see "DreamersAgent.exe register", P2-5) — sends the same
/// snapshot as a heartbeat. Metrics are always collected and logged
/// locally even when unregistered or when the server is unreachable;
/// heartbeat delivery is best-effort and never allowed to affect that.
/// </summary>
public sealed class Worker : BackgroundService
{
    private readonly ILogger<Worker> _logger;
    private readonly AgentConfig _config;
    private readonly MetricsCollector _metricsCollector;
    private readonly AgentCredentialStore _credentialStore;
    private readonly ServerClient _serverClient;
    private readonly CommandExecutor _commandExecutor;
    private readonly TestJobRunner _jobRunner;

    public Worker(
        ILogger<Worker> logger,
        AgentConfig config,
        MetricsCollector metricsCollector,
        AgentCredentialStore credentialStore,
        ServerClient serverClient,
        CommandExecutor commandExecutor,
        TestJobRunner jobRunner)
    {
        _logger = logger;
        _config = config;
        _metricsCollector = metricsCollector;
        _credentialStore = credentialStore;
        _serverClient = serverClient;
        _commandExecutor = commandExecutor;
        _jobRunner = jobRunner;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation(
            "Dreamers Agent starting. AgentId={AgentId} ServerUrl={ServerUrl} IntervalSeconds={IntervalSeconds}",
            _config.AgentId, _config.ServerUrl, _config.UpdateIntervalSeconds);

        var credential = _credentialStore.Load();
        if (credential is null)
        {
            _logger.LogWarning(
                "No agent credential found — this workstation is not registered with the server yet. " +
                "Run \"DreamersAgent.exe register <token>\" to pair it (token comes from the dashboard admin). " +
                "Metrics will still be collected and logged locally in the meantime.");
        }

        var interval = TimeSpan.FromSeconds(Math.Max(1, _config.UpdateIntervalSeconds));

        while (!stoppingToken.IsCancellationRequested)
        {
            SystemMetricsSnapshot? snapshot = null;

            try
            {
                snapshot = _metricsCollector.Collect();
                _logger.LogInformation(
                    "Metrics: Host={Hostname} OS={OperatingSystem} ({OsVersion}, {Architecture}) " +
                    "Uptime={Uptime} CPU=\"{CpuName}\" ({LogicalCores} logical/{PhysicalCores} physical) " +
                    "CpuUsage={CpuUsage} RAM={UsedMb}/{TotalMb}MB ({RamUsage}%)",
                    snapshot.Hostname,
                    snapshot.OperatingSystem,
                    snapshot.OsVersion,
                    snapshot.Architecture,
                    snapshot.Uptime,
                    snapshot.Cpu?.Name ?? "n/a",
                    snapshot.Cpu?.LogicalProcessorCount ?? 0,
                    snapshot.Cpu?.PhysicalCoreCount ?? 0,
                    snapshot.Cpu?.UtilizationPercent is { } cpuPct ? $"{cpuPct:F1}%" : "n/a (first sample)",
                    snapshot.Memory?.UsedMb ?? 0,
                    snapshot.Memory?.TotalMb ?? 0,
                    snapshot.Memory?.UsagePercent.ToString("F1") ?? "n/a");

                if (snapshot.Gpus.Count > 0)
                {
                    var gpuSummary = string.Join(" | ", snapshot.Gpus.Select(g =>
                        $"GPU{g.Index}=\"{g.Name}\" Util={g.UtilizationPercent:F0}% " +
                        $"VRAM={g.VramUsedMb}/{g.VramTotalMb}MB ({g.VramUsagePercent:F1}%) " +
                        $"Temp={(g.TemperatureCelsius is { } t ? $"{t}C" : "n/a")}"));
                    _logger.LogInformation("GPUs: {GpuSummary}", gpuSummary);
                }
                else
                {
                    _logger.LogDebug("No GPUs reported (no NVIDIA GPU or NVML unavailable)");
                }

                if (snapshot.Disks.Count > 0)
                {
                    var diskSummary = string.Join(" | ", snapshot.Disks.Select(d =>
                        $"{d.Name} {d.UsedMb}/{d.TotalMb}MB ({d.UsagePercent:F1}%)"));
                    _logger.LogInformation("Disks: {DiskSummary}", diskSummary);
                }

                var runningApps = snapshot.Processes.Where(p => p.Running).ToList();
                _logger.LogInformation(
                    "Apps: {RunningCount}/{TotalCount} running{RunningSummary}",
                    runningApps.Count,
                    snapshot.Processes.Count,
                    runningApps.Count > 0
                        ? " — " + string.Join(", ", runningApps.Select(p => $"{p.Name} (pid {p.Pid}, {p.RamMb}MB)"))
                        : string.Empty);
            }
            catch (Exception ex)
            {
                // A single failed tick must never take the whole service
                // down — MetricsCollector already isolates each sub-collector
                // internally, so reaching here means something outside that
                // (e.g. the logging call itself) went wrong.
                _logger.LogError(ex, "Unhandled error during agent tick");
            }

            if (snapshot is not null && credential is not null)
            {
                try
                {
                    var runningJob = _jobRunner.GetSnapshot() is { Finished: false } running
                        ? new RunningJobStatus(running.JobId, running.Progress)
                        : null;

                    var heartbeat = await _serverClient.SendHeartbeatAsync(credential, snapshot, runningJob, stoppingToken);
                    _logger.LogDebug("Heartbeat sent.");

                    if (heartbeat.Command is not null)
                    {
                        await HandlePendingCommandAsync(credential, heartbeat.Command, stoppingToken);
                    }

                    // P3-4: only one job at a time (see TestJobRunner) — if
                    // the server assigned one while the runner is still
                    // busy, it just stays ASSIGNED server-side and gets
                    // handed to us again on a later heartbeat once we have
                    // capacity, per job/repository.ts's
                    // getAssignedJobForWorker.
                    if (heartbeat.Job is { } assignedJob && !_jobRunner.IsBusy)
                    {
                        _logger.LogInformation(
                            "Starting job {JobId} ({JobType}), requested via the dashboard",
                            assignedJob.Id, assignedJob.Type);
                        _jobRunner.Start(assignedJob.Id, assignedJob.Input);
                    }
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    // Network blips, server restarts, DNS hiccups — all
                    // expected occasionally on a LAN. Local metrics were
                    // already collected and logged above regardless; this
                    // failure only affects what the dashboard sees, not the
                    // agent's own health.
                    _logger.LogWarning(ex, "Failed to send heartbeat to server");
                }

                // Independent of whether the heartbeat above succeeded —
                // a finished job should get reported even if, say, this
                // exact tick's heartbeat call happened to fail.
                if (_jobRunner.GetSnapshot() is { Finished: true } finished)
                {
                    await ReportFinishedJobAsync(credential, finished, stoppingToken);
                }
            }

            try
            {
                await Task.Delay(interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        _logger.LogInformation("Dreamers Agent stopping. AgentId={AgentId}", _config.AgentId);
    }

    // P2-8: a restart/shutdown queued by an admin rides the heartbeat
    // response (see ServerClient.SendHeartbeatAsync) rather than being
    // pushed — the Agent has no inbound listener. Structured whitelist
    // only, never arbitrary shell: unrecognized command names are logged
    // and dropped, never executed. See docs/SECURITY.md.
    private async Task HandlePendingCommandAsync(string credential, string commandName, CancellationToken cancellationToken)
    {
        if (!AgentCommandParser.TryParse(commandName, out var command))
        {
            _logger.LogWarning("Server sent an unrecognized command {Command} — ignoring", commandName);
            return;
        }

        _logger.LogWarning("Executing {Command}, requested via the dashboard", command);

        try
        {
            _commandExecutor.Execute(command);
            await _serverClient.SendCommandResultAsync(credential, commandName, ok: true, detail: null, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to execute {Command}", command);
            try
            {
                await _serverClient.SendCommandResultAsync(credential, commandName, ok: false, ex.Message, cancellationToken);
            }
            catch (Exception reportEx)
            {
                _logger.LogWarning(reportEx, "Failed to report command failure to server");
            }
        }
    }

    // P3-4: report the TestJobRunner's finished result and free it up for
    // the next job. Only resets on a successful report — if the POST
    // fails (network blip), the finished snapshot stays put and this is
    // retried on the next tick rather than the result being lost.
    private async Task ReportFinishedJobAsync(string credential, TestJobRunner.Snapshot finished, CancellationToken cancellationToken)
    {
        _logger.LogInformation(
            "Job {JobId} finished: {Result}", finished.JobId, finished.Success ? "success" : $"failed ({finished.Error})");

        try
        {
            await _serverClient.SendJobResultAsync(credential, finished.JobId, finished.Success, finished.Error, cancellationToken);
            _jobRunner.Reset();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to report job {JobId} result to server, will retry next tick", finished.JobId);
        }
    }
}
