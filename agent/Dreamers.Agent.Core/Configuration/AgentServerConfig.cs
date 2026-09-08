namespace Dreamers.Agent.Core.Configuration;

/// <summary>
/// One server this Agent reports to. The Agent heartbeats every entry —
/// metrics, capabilities and remote restart/shutdown commands are useful
/// to both Dreamers Remote (workstation management) and Dreamers Encoder
/// (the render farm) — but exactly one entry may own jobs.
///
/// Job ownership is exclusive for a concrete reason, not for tidiness:
/// job ids are per-server autoincrement integers, so job 5 on one server
/// and job 5 on the other are different work. The Agent tracks running
/// jobs by id, so two scheduling servers would collide on the id space
/// and cancel or report results against the wrong job. Making ownership
/// a single local setting removes the possibility entirely — there is no
/// negotiation to get wrong and no split-brain to recover from.
/// </summary>
public sealed class AgentServerConfig
{
    public string Url { get; set; } = string.Empty;

    /// <summary>
    /// Whether this server may assign jobs to this Agent. Assignments and
    /// cancellations from any other server are ignored and logged — a
    /// silent ignore would hide the real problem, which is that someone
    /// left scheduling enabled on a server that no longer owns it.
    /// </summary>
    public bool JobOwner { get; set; }
}
