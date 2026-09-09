using System.Text.Json.Serialization;

namespace Dreamers.Agent.Core.Configuration;

/// <summary>
/// Persisted agent configuration + identity. Written to
/// C:\ProgramData\DreamersRemote\agent.json. AgentId is generated once on
/// first run and must never change afterward — it is how a server tells
/// this machine apart from any other, since IPs can change. The same
/// AgentId is presented to every configured server; they keep separate
/// databases, so there is no collision.
/// </summary>
public sealed class AgentConfig
{
    public string AgentId { get; set; } = string.Empty;

    /// <summary>
    /// Legacy single-server field, kept so an agent.json written by an
    /// older Agent still loads. AgentConfigStore migrates it into
    /// <see cref="Servers"/> on load; nothing else should read it.
    /// </summary>
    // Plain HTTP, not HTTPS: the deployed servers have no TLS cert
    // configured (LAN-only, see docs/SECURITY.md) — using https:// here
    // would make every registration/heartbeat call fail outright.
    public string ServerUrl { get; set; } = "http://192.29.11.92:8080";

    /// <summary>
    /// Every server this Agent reports to. Exactly one may own jobs; see
    /// <see cref="AgentServerConfig"/> for why that is exclusive.
    /// </summary>
    public List<AgentServerConfig> Servers { get; set; } = new();

    public int UpdateIntervalSeconds { get; set; } = 5;

    /// <summary>
    /// The server allowed to assign jobs, or null when none is marked.
    /// A config with no owner still heartbeats and still accepts
    /// restart/shutdown — it simply runs no jobs, which is a legitimate
    /// state for a machine kept for remote access only.
    ///
    /// Derived from <see cref="Servers"/>, never persisted. Without
    /// JsonIgnore it is written into agent.json as a duplicate copy of
    /// the owning entry, which reads like a setting someone can edit —
    /// and editing it would do nothing at all, because deserialization
    /// has no setter to write it back to.
    /// </summary>
    [JsonIgnore]
    public AgentServerConfig? JobOwner => Servers.FirstOrDefault(s => s.JobOwner);
}
