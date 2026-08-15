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
}
