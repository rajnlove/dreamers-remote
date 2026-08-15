using System.Runtime.InteropServices;
using Microsoft.Extensions.Logging;

namespace Dreamers.Agent.Core.Metrics;

/// <summary>
/// Orchestrates the individual collectors, wrapping each in its own
/// try/catch so one broken collector (classically: GPU/NVML in P2-3) can
/// never take the others down with it — every section of the snapshot is
/// independently optional.
/// </summary>
public sealed class MetricsCollector
{
    private readonly ILogger<MetricsCollector> _logger;
    private readonly CpuCollector _cpuCollector;
    private readonly MemoryCollector _memoryCollector;
    private readonly GpuCollector _gpuCollector;

    public MetricsCollector(ILogger<MetricsCollector> logger)
        : this(logger, new CpuCollector(), new MemoryCollector(), new GpuCollector())
    {
    }

    internal MetricsCollector(
        ILogger<MetricsCollector> logger,
        CpuCollector cpuCollector,
        MemoryCollector memoryCollector,
        GpuCollector gpuCollector)
    {
        _logger = logger;
        _cpuCollector = cpuCollector;
        _memoryCollector = memoryCollector;
        _gpuCollector = gpuCollector;
    }

    public SystemMetricsSnapshot Collect()
    {
        var snapshot = new SystemMetricsSnapshot
        {
            Hostname = Environment.MachineName,
            Architecture = RuntimeInformation.OSArchitecture.ToString(),
            AgentVersion = AgentVersionReader.Read(),
            OsVersion = Environment.OSVersion.VersionString,
            OperatingSystem = "Unknown",
        };

        try
        {
            var (caption, version) = OperatingSystemInfo.Read();
            snapshot.OperatingSystem = caption;
            snapshot.OsVersion = version;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "OS info collector failed; using fallback values");
        }

        try
        {
            snapshot.Uptime = SystemUptime.Read();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Uptime collector failed");
        }

        try
        {
            snapshot.Cpu = _cpuCollector.Collect();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "CPU collector failed");
        }

        try
        {
            snapshot.Memory = _memoryCollector.Collect();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Memory collector failed");
        }

        try
        {
            snapshot.Gpus = _gpuCollector.Collect();
        }
        catch (Exception ex)
        {
            // Expected to be the flakiest collector (missing driver, NVML
            // version mismatch, GPU in a weird power state) — must never
            // affect CPU/RAM/OS reporting, which is why this is last and
            // still wrapped just like everything else.
            _logger.LogWarning(ex, "GPU collector failed");
        }

        return snapshot;
    }
}
