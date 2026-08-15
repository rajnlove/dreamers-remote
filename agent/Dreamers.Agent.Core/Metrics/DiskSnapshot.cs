namespace Dreamers.Agent.Core.Metrics;

public sealed class DiskSnapshot
{
    /// <summary>Drive root, e.g. "C:\".</summary>
    public string Name { get; init; } = string.Empty;
    public long TotalMb { get; init; }
    public long UsedMb { get; init; }
    public long FreeMb { get; init; }
    public double UsagePercent { get; init; }
}
