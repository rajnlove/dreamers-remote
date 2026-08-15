using System.Runtime.InteropServices;
using Dreamers.Agent.Core.Configuration;
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
    private readonly DiskCollector _diskCollector;
    private readonly ProcessCollector _processCollector;

    public MetricsCollector(ILogger<MetricsCollector> logger, MonitoredProcessesConfig processesConfig)
        : this(
            logger,
            new CpuCollector(),
            new MemoryCollector(),
            new GpuCollector(),
            new DiskCollector(),
            new ProcessCollector(processesConfig))
    {
    }

    internal MetricsCollector(
        ILogger<MetricsCollector> logger,
        CpuCollector cpuCollector,
        MemoryCollector memoryCollector,
        GpuCollector gpuCollector,
        DiskCollector diskCollector,
        ProcessCollector processCollector)
    {
        _logger = logger;
        _cpuCollector = cpuCollector;
        _memoryCollector = memoryCollector;
        _gpuCollector = gpuCollector;
        _diskCollector = diskCollector;
        _processCollector = processCollector;
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

        try
        {
            snapshot.Disks = _diskCollector.Collect();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Disk collector failed");
        }

        try
        {
            snapshot.Processes = _processCollector.Collect();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Process collector failed");
        }

        return snapshot;
    }
}
