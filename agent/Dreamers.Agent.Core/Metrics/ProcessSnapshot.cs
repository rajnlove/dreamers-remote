namespace Dreamers.Agent.Core.Metrics;

public sealed class ProcessSnapshot
{
    /// <summary>The configured pattern this matched against, e.g. "AfterFX.exe" or "Nuke*.exe".</summary>
    public string Name { get; init; } = string.Empty;
    public bool Running { get; init; }
    public int? Pid { get; init; }
    public long? RamMb { get; init; }
    public DateTime? StartTimeUtc { get; init; }
}
