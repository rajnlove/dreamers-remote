namespace Dreamers.Agent.Core.Configuration;

/// <summary>
/// Persisted agent configuration + identity. Written to
/// C:\ProgramData\DreamersRemote\agent.json. AgentId is generated once on
/// first run and must never change afterward — it is how the server tells
/// this machine apart from any other, since IPs can change.
/// </summary>
public sealed class AgentConfig
{
    public string AgentId { get; set; } = string.Empty;

    // Plain HTTP, not HTTPS: the deployed server has no TLS cert configured
    // (LAN-only V1, see docs/SECURITY.md) — using https:// here would make
    // every registration/heartbeat call fail outright.
    public string ServerUrl { get; set; } = "http://192.29.11.92:8080";

    public int UpdateIntervalSeconds { get; set; } = 5;
}
