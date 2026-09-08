namespace Dreamers.Agent.Core.Metrics;

public sealed class SystemMetricsSnapshot
{
    public string Hostname { get; set; } = string.Empty;
    public string OperatingSystem { get; set; } = string.Empty;
    public string OsVersion { get; set; } = string.Empty;
    public string Architecture { get; set; } = string.Empty;
    public TimeSpan? Uptime { get; set; }
    public string AgentVersion { get; set; } = string.Empty;
    public CpuSnapshot? Cpu { get; set; }
    public MemorySnapshot? Memory { get; set; }

    /// <summary>Empty (not null) when there are no NVIDIA GPUs or NVML is unavailable.</summary>
    public IReadOnlyList<GpuSnapshot> Gpus { get; set; } = Array.Empty<GpuSnapshot>();

    public IReadOnlyList<DiskSnapshot> Disks { get; set; } = Array.Empty<DiskSnapshot>();

    /// <summary>
    /// Free space on the configured NAS roots. Empty when no roots are
    /// allow-listed or none is reachable — the server must treat "no
    /// data" as "unknown", never as "plenty of room".
    /// </summary>
    public IReadOnlyList<NasSpaceSnapshot> NasSpace { get; set; } = Array.Empty<NasSpaceSnapshot>();

    /// <summary>One entry per configured monitored_processes.json pattern, whether running or not.</summary>
    public IReadOnlyList<ProcessSnapshot> Processes { get; set; } = Array.Empty<ProcessSnapshot>();
}
