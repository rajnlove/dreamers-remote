namespace Dreamers.Agent.Core.Metrics;

public sealed class CpuSnapshot
{
    public string Name { get; init; } = string.Empty;
    public int LogicalProcessorCount { get; init; }
    public int PhysicalCoreCount { get; init; }

    /// <summary>
    /// Null on the very first sample after startup — utilization needs a
    /// delta between two ticks, so there is nothing to report yet.
    /// </summary>
    public double? UtilizationPercent { get; init; }
}
