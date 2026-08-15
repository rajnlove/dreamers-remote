using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Metrics;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Dreamers.Agent;

/// <summary>
/// P2-2/P2-3 scope: collects and logs CPU/RAM/OS/uptime/GPU on each tick.
/// No server communication yet (P2-5) — this only proves the collectors
/// work and log correctly, locally.
/// </summary>
public sealed class Worker : BackgroundService
{
    private readonly ILogger<Worker> _logger;
    private readonly AgentConfig _config;
    private readonly MetricsCollector _metricsCollector;

    public Worker(ILogger<Worker> logger, AgentConfig config, MetricsCollector metricsCollector)
    {
        _logger = logger;
        _config = config;
        _metricsCollector = metricsCollector;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation(
            "Dreamers Agent starting. AgentId={AgentId} ServerUrl={ServerUrl} IntervalSeconds={IntervalSeconds}",
            _config.AgentId, _config.ServerUrl, _config.UpdateIntervalSeconds);

        var interval = TimeSpan.FromSeconds(Math.Max(1, _config.UpdateIntervalSeconds));

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var snapshot = _metricsCollector.Collect();
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
}
