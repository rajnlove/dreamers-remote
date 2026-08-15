namespace Dreamers.Agent.Core.Metrics;

public sealed class GpuSnapshot
{
    public int Index { get; init; }
    public string Name { get; init; } = string.Empty;
    public double UtilizationPercent { get; init; }
    public long VramUsedMb { get; init; }
    public long VramTotalMb { get; init; }
    public double VramUsagePercent { get; init; }

    /// <summary>Null if the temperature sensor read failed for this GPU.</summary>
    public int? TemperatureCelsius { get; init; }
}
