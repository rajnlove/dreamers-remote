using Dreamers.Agent.Core.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Dreamers.Agent;

/// <summary>
/// P2-1 scope: proves the service host, config, and logging work end to
/// end. Metrics collection, heartbeats, and command handling land in
/// P2-2 onward — this loop only ticks on the configured interval.
/// </summary>
public sealed class Worker : BackgroundService
{
    private readonly ILogger<Worker> _logger;
    private readonly AgentConfig _config;

    public Worker(ILogger<Worker> logger, AgentConfig config)
    {
        _logger = logger;
        _config = config;
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
                _logger.LogDebug("Agent tick. AgentId={AgentId}", _config.AgentId);
            }
            catch (Exception ex)
            {
                // A single failed tick must never take the whole service down —
                // this pattern carries forward once real collectors (CPU/RAM/GPU/
                // disk) land in P2-2+, each wrapped so one failing collector
                // can't stop the others from reporting.
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
