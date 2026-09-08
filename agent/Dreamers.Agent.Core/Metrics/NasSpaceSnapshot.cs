namespace Dreamers.Agent.Core.Metrics;

/// <summary>
/// Free space on one configured NAS root, as seen from this workstation.
///
/// Reported by the Agent rather than measured by the server because the
/// server runs in a container with no NAS mount — it has no way to see
/// the share at all. The Agent already has the UNC path mapped in order
/// to read sources and write outputs, so it is the only component that
/// can answer the question the "NAS low space" alert needs.
/// </summary>
public sealed class NasSpaceSnapshot
{
    /// <summary>The configured root, e.g. "\\192.29.11.92\web_data\www\Projects".</summary>
    public string Root { get; init; } = string.Empty;

    public long TotalMb { get; init; }
    public long FreeMb { get; init; }

    /// <summary>Free space as a percentage of total, rounded to one decimal.</summary>
    public double FreePercent { get; init; }
}
