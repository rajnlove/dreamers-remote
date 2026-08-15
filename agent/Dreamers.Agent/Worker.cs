using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Metrics;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Dreamers.Agent;

/// <summary>
/// P2-2 scope: collects and logs CPU/RAM/OS/uptime on each tick. No
/// server communication yet (P2-5) — this only proves the collectors
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
