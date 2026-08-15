namespace Dreamers.Agent.Core.Metrics;

public sealed class MemorySnapshot
{
    public long TotalMb { get; init; }
    public long UsedMb { get; init; }
    public long AvailableMb { get; init; }
    public double UsagePercent { get; init; }
}
