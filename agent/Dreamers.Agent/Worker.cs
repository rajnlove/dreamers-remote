using Dreamers.Agent.Core.Commands;
using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Credentials;
using Dreamers.Agent.Core.Jobs;
using Dreamers.Agent.Core.Metrics;
using Dreamers.Agent.Core.Server;
using Dreamers.Agent.Core.Topaz;
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
    private readonly IReadOnlyList<ServerConnection> _servers;
    private readonly AgentConfigStore _configStore;
    private readonly CommandExecutor _commandExecutor;
    private readonly IReadOnlyDictionary<string, IJobRunner> _jobRunners;

    public Worker(
        ILogger<Worker> logger,
        AgentConfig config,
        MetricsCollector metricsCollector,
        IReadOnlyList<ServerConnection> servers,
        AgentConfigStore configStore,
        CommandExecutor commandExecutor,
        TestJobRunner testJobRunner,
        FfmpegJobRunner ffmpegJobRunner,
        TopazJobRunner topazJobRunner)
    {
        _logger = logger;
        _config = config;
        _metricsCollector = metricsCollector;
        _servers = servers;
        _configStore = configStore;
        _commandExecutor = commandExecutor;
        // P4-2: one IJobRunner per job type this Agent knows how to run,
        // keyed by the same string used as the job's `type` and as a
        // WorkerCapabilities entry -- adding a new job type later means
        // adding a runner here, not branching inside this class.
        _jobRunners = new Dictionary<string, IJobRunner>
        {
            ["test"] = testJobRunner,
            ["ffmpeg"] = ffmpegJobRunner,
            ["topaz"] = topazJobRunner,
        };
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation(
            "Dreamers Agent starting. AgentId={AgentId} Servers={ServerCount} IntervalSeconds={IntervalSeconds}",
            _config.AgentId, _servers.Count, _config.UpdateIntervalSeconds);

        foreach (var server in _servers)
        {
            _logger.LogInformation(
                "  {ServerUrl} - {Role}, {Registered}",
                server.Url,
                server.JobOwner ? "owns jobs" : "metrics and commands only",
                server.Credential is null ? "NOT REGISTERED" : "registered");
        }

        // A machine reporting to two servers but paired with neither looks
        // identical, in the dashboard, to one that is simply switched off.
        // Say it once at startup, naming the server, so the fix is obvious.
        foreach (var server in _servers.Where(s => s.Credential is null))
        {
            _logger.LogWarning(
                "No agent credential for {ServerUrl} — this workstation is not registered with that server yet. " +
                "Run \"DreamersAgent.exe register <token> --server {ServerUrl}\" to pair it. " +
                "Metrics are still collected and logged locally in the meantime.",
                server.Url, server.Url);
        }

        if (_servers.All(s => !s.JobOwner))
        {
            _logger.LogWarning(
                "No configured server owns jobs — this Agent will report metrics and accept restart/shutdown, " +
                "but will never run a render job. Set \"jobOwner\": true on exactly one entry in agent.json.");
        }

        // P4-3: computed once here (Lazy, see WorkerCapabilities) and
        // logged with its specific authentication/permission/network
        // category — the heartbeat itself only ever sends a bare
        // "ffmpeg" capability present-or-absent, this is the one place
        // an operator can see *why* it's absent without digging through
        // NasHealthChecker's source.
        var nasHealth = Core.Worker.WorkerCapabilities.NasHealth;
        if (nasHealth.Ok)
        {
            _logger.LogInformation("NAS health check passed: {Message}", nasHealth.Message);
        }
        else if (nasHealth.Category == Core.Ffmpeg.NasConnectCategory.NotConfigured)
        {
            _logger.LogInformation("NAS health check skipped: {Message}", nasHealth.Message);
        }
        else
        {
            _logger.LogWarning(
                "NAS health check failed ({Category}): {Message} — the \"ffmpeg\"/\"topaz\" capabilities will not be reported until this is fixed.",
                nasHealth.Category, nasHealth.Message);
        }

        // P4-4: same "log the specific reason" treatment as the NAS check
        // above, for the other half of the "topaz" capability gate.
        var topazInfo = Core.Worker.WorkerCapabilities.TopazInfo;
        if (topazInfo.Available)
        {
            _logger.LogInformation("Topaz Video AI detected: version {Version}", topazInfo.Version);
        }
        else
        {
            _logger.LogInformation("Topaz Video AI not detected on this machine — the \"topaz\" capability will not be reported.");
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

            if (snapshot is not null)
            {
                // P4-3H: every job any runner currently has in flight —
                // was "the first non-finished snapshot" (singular) back
                // when an Agent only ever ran one job at a time. See
                // IJobRunner's doc comment. Computed once and reported to
                // every server: both dashboards should show live progress,
                // even though only one of them assigned the work.
                var runningJobs = _jobRunners.Values
                    .SelectMany(r => r.GetSnapshots())
                    .Where(s => !s.Finished)
                    .Select(s => new RunningJobStatus(s.JobId, s.Progress, s.Fps, s.EtaSeconds))
                    .ToList();

                foreach (var server in _servers)
                {
                    if (server.Credential is null)
                    {
                        continue;
                    }

                    try
                    {
                        var heartbeat = await server.Client.SendHeartbeatAsync(
                            server.Credential, snapshot, runningJobs,
                            server.JobOwner, _config.JobOwner?.Url, stoppingToken);
                        _logger.LogDebug("Heartbeat sent to {ServerUrl}.", server.Url);

                        if (heartbeat.Command is not null)
                        {
                            // Accepted from every server on purpose:
                            // restarting a machine is workstation
                            // administration, not job scheduling, and it
                            // carries no state that two servers could
                            // disagree about.
                            await HandlePendingCommandAsync(server, heartbeat.Command, stoppingToken);
                        }

                        await HandleJobDirectivesAsync(server, heartbeat, stoppingToken);
                    }
                    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                    {
                        break;
                    }
                    catch (Exception ex)
                    {
                        // Network blips, server restarts, DNS hiccups — all
                        // expected occasionally on a LAN. Caught per server
                        // so one being down cannot stop the Agent talking to
                        // the other: if the render farm is unreachable, the
                        // workstation dashboard must still see this machine,
                        // and if the workstation server is unreachable, jobs
                        // must still run.
                        _logger.LogWarning(ex, "Failed to send heartbeat to {ServerUrl}", server.Url);
                    }
                }

                // Results go only to the server that assigned the work —
                // it is the only one holding that job id. Independent of
                // whether the heartbeat above succeeded: a finished job
                // should still be reported even if this exact tick's
                // heartbeat happened to fail.
                var owner = _servers.FirstOrDefault(s => s.JobOwner && s.Credential is not null);
                if (owner is not null)
                {
                    // P4-3H: a runner can have more than one finished-but-
                    // not-yet-reported job now (e.g. two ffmpeg jobs on two
                    // GPUs finishing around the same tick).
                    foreach (var runner in _jobRunners.Values)
                    {
                        foreach (var finished in runner.GetSnapshots().Where(s => s.Finished))
                        {
                            await ReportFinishedJobAsync(owner, runner, finished, stoppingToken);
                        }
                    }
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

    /// <summary>
    /// Acts on the job assignments and cancellations in one server's
    /// heartbeat response — but only when that server owns jobs.
    ///
    /// A non-owner sending work is not ignored quietly. Job ids are
    /// per-server autoincrement, so obeying two servers would mean two
    /// different jobs sharing an id and this Agent cancelling or
    /// reporting results against the wrong one. When it happens the real
    /// problem is upstream — someone left scheduling enabled on a server
    /// that no longer owns this machine — and a silent drop would hide
    /// exactly that, leaving jobs sitting ASSIGNED forever with no clue
    /// why.
    /// </summary>
    private async Task HandleJobDirectivesAsync(ServerConnection server, HeartbeatResult heartbeat, CancellationToken cancellationToken)
    {
        if (!server.JobOwner)
        {
            if (heartbeat.Jobs.Count > 0 || heartbeat.CancelJobIds.Count > 0)
            {
                var owner = _config.JobOwner?.Url ?? "no server";
                _logger.LogWarning(
                    "{ServerUrl} sent {JobCount} job assignment(s) and {CancelCount} cancellation(s) but this machine takes jobs from {Owner} — rejecting.",
                    server.Url, heartbeat.Jobs.Count, heartbeat.CancelJobIds.Count, owner);

                // Rejected explicitly, not dropped. The server marks a job
                // RUNNING the moment it hands it over, so staying silent
                // leaves it to time out 30s later as "the Agent died
                // mid-job" — a misleading symptom that sends whoever reads
                // it looking at the machine instead of at the setting that
                // is actually wrong.
                foreach (var assignedJob in heartbeat.Jobs)
                {
                    await ReportRejectedJobAsync(server, assignedJob.Id, owner, cancellationToken);
                }
            }

            return;
        }

        // P3-5: a job we're running was cancelled server-side
        // (POST /api/jobs/:id/cancel) — stop it. Nothing to report back;
        // the server is already authoritative. Broadcast each id to every
        // runner (harmless no-op on the ones not actually running that
        // jobId) rather than needing to know which runner owns which job.
        foreach (var cancelId in heartbeat.CancelJobIds)
        {
            _logger.LogInformation("Job {JobId} was cancelled — stopping", cancelId);
            foreach (var runner in _jobRunners.Values)
            {
                runner.Cancel(cancelId);
            }
        }

        // P4-3H: start every newly assigned job — no more "only one job
        // across the whole Agent" gate. The server is the sole authority
        // on not double-booking a GPU slot (job/scheduler.ts's per-slot
        // busy tracking already covers that), so each runner just needs
        // to track the jobs it's given independently by id.
        foreach (var assignedJob in heartbeat.Jobs)
        {
            if (_jobRunners.TryGetValue(assignedJob.Type, out var runner))
            {
                _logger.LogInformation(
                    "Starting job {JobId} ({JobType}) from {ServerUrl}{GpuSlot}",
                    assignedJob.Id, assignedJob.Type, server.Url,
                    assignedJob.GpuSlot is { } slot ? $" on GPU slot {slot}" : string.Empty);
                runner.Start(assignedJob.Id, assignedJob.Input, assignedJob.GpuSlot);
            }
            else
            {
                // Shouldn't happen — the scheduler only assigns by
                // matching this Agent's own reported capabilities
                // (WorkerCapabilities) — but report it as a failed job
                // rather than leaving it stuck ASSIGNED forever.
                _logger.LogError("Assigned job {JobId} has type {JobType} with no registered runner on this Agent", assignedJob.Id, assignedJob.Type);
                await ReportUnrunnableJobAsync(server, assignedJob.Id, assignedJob.Type, cancellationToken);
            }
        }
    }

    // P2-8: a restart/shutdown queued by an admin rides the heartbeat
    // response (see ServerClient.SendHeartbeatAsync) rather than being
    // pushed — the Agent has no inbound listener. Structured whitelist
    // only, never arbitrary shell: unrecognized command names are logged
    // and dropped, never executed. See docs/SECURITY.md.
    private async Task HandlePendingCommandAsync(ServerConnection server, string commandName, CancellationToken cancellationToken)
    {
        if (!AgentCommandParser.TryParse(commandName, out var command))
        {
            _logger.LogWarning("Server sent an unrecognized command {Command} — ignoring", commandName);
            return;
        }

        if (command is AgentCommand.ClaimJobs or AgentCommand.ReleaseJobs)
        {
            await ApplyJobOwnershipAsync(server, command, commandName, cancellationToken);
            return;
        }

        _logger.LogWarning("Executing {Command}, requested via the dashboard", command);

        try
        {
            _commandExecutor.Execute(command);
            await server.Client.SendCommandResultAsync(server.Credential!, commandName, ok: true, detail: null, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to execute {Command}", command);
            try
            {
                await server.Client.SendCommandResultAsync(server.Credential!, commandName, ok: false, ex.Message, cancellationToken);
            }
            catch (Exception reportEx)
            {
                _logger.LogWarning(reportEx, "Failed to report command failure to server");
            }
        }
    }

    /// <summary>
    /// Moves job ownership in response to the dashboard switch.
    ///
    /// claim-jobs points ownership at the server that asked. release-jobs
    /// is the other end of the same switch: the asking server steps down,
    /// and the one other configured server takes over — that is the
    /// "hand it back to the other dashboard" case. With no other server
    /// configured, release-jobs simply clears ownership (a remote-access-
    /// only machine, same state as a fresh agent.json with jobOwner:false).
    /// The dual-server model never has more than two entries, so "the
    /// other one" is unambiguous; if that ever changes, ownership is
    /// cleared rather than guessed at and the operator claims it
    /// explicitly from the dashboard they want.
    ///
    /// Applied in memory as well as on disk: ServerConnection reads
    /// ownership straight off the shared AgentServerConfig objects, so the
    /// change takes effect on the very next heartbeat. Requiring a service
    /// restart would leave a window where the dashboard says one thing and
    /// the Agent does another — which is the confusion this whole feature
    /// exists to remove.
    /// </summary>
    private async Task ApplyJobOwnershipAsync(
        ServerConnection server, AgentCommand command, string commandName, CancellationToken cancellationToken)
    {
        var previous = _config.JobOwner?.Url;

        AgentServerConfig? target;
        if (command == AgentCommand.ClaimJobs)
        {
            target = server.Config;
        }
        else
        {
            var others = _config.Servers.Where(s => !ReferenceEquals(s, server.Config)).ToList();
            target = others.Count == 1 ? others[0] : null;
        }

        var targetUrl = target?.Url;
        if (previous == targetUrl)
        {
            _logger.LogInformation(
                "Job ownership already where {Command} would put it ({Target})", commandName, targetUrl ?? "(none)");
        }
        else
        {
            // Exactly one owner. Two would mean two servers handing out
            // ids from their own sequences, and this Agent cancelling or
            // reporting results against the wrong job.
            foreach (var entry in _config.Servers)
            {
                entry.JobOwner = false;
            }

            if (target is not null)
            {
                target.JobOwner = true;
            }

            try
            {
                _configStore.Save(_config);
            }
            catch (Exception ex)
            {
                // The in-memory change still stands, so behaviour is
                // correct until the next restart — but say so loudly,
                // because a silent revert on reboot is exactly the kind of
                // drift nobody thinks to look for.
                _logger.LogError(
                    ex, "Job ownership moved to {Target} but agent.json could not be written", targetUrl ?? "(none)");
            }

            _logger.LogWarning(
                "Job ownership moved from {Previous} to {Target}, requested via the dashboard ({Command})",
                previous ?? "(none)", targetUrl ?? "(none)", commandName);
        }

        var detail = target is not null
            ? $"jobs now owned by {targetUrl}"
            : "jobs released — no other server configured to take them";
        try
        {
            await server.Client.SendCommandResultAsync(
                server.Credential!, commandName, ok: true, detail: detail, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to report {Command} result to {ServerUrl}", commandName, server.Url);
        }
    }

    // P3-4/P4-2: report a runner's finished result and free it up for the
    // next job. Only resets on a successful report — if the POST fails
    // (network blip), the finished snapshot stays put and this is
    // retried on the next tick rather than the result being lost.
    private async Task ReportFinishedJobAsync(ServerConnection server, IJobRunner runner, JobSnapshot finished, CancellationToken cancellationToken)
    {
        _logger.LogInformation(
            "Job {JobId} finished: {Result}", finished.JobId, finished.Success ? "success" : $"failed ({finished.Error})");

        try
        {
            await server.Client.SendJobResultAsync(server.Credential!, finished.JobId, finished.Success, finished.Output, finished.Error, cancellationToken);
            runner.Reset(finished.JobId);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to report job {JobId} result to server, will retry next tick", finished.JobId);
        }
    }

    // Tells the non-owning server, in its own job record, why nothing is
    // going to happen — so the reason shows up where someone is already
    // looking, instead of only in this machine's log file.
    private async Task ReportRejectedJobAsync(ServerConnection server, int jobId, string owner, CancellationToken cancellationToken)
    {
        try
        {
            await server.Client.SendJobResultAsync(
                server.Credential!, jobId, ok: false, output: null,
                error: $"This machine takes jobs from {owner}, not {server.Url}. " +
                       "Turn off job scheduling for it here, or claim ownership from this server.",
                cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to reject job {JobId} back to {ServerUrl}", jobId, server.Url);
        }
    }

    // Defensive fallback for a job assigned to this Agent for a type it
    // has no IJobRunner for (see the "Starting job" branch above) — report
    // it failed immediately rather than let it sit ASSIGNED forever with
    // nothing ever picking it up.
    private async Task ReportUnrunnableJobAsync(ServerConnection server, int jobId, string jobType, CancellationToken cancellationToken)
    {
        try
        {
            await server.Client.SendJobResultAsync(
                server.Credential!, jobId, ok: false, output: null, error: $"This Agent has no runner registered for job type \"{jobType}\"", cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to report unrunnable job {JobId} to server", jobId);
        }
    }
}
