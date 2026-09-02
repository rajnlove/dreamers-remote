using Dreamers.Agent.Core.Metrics;
using Dreamers.Agent.Core.Worker;

namespace Dreamers.Agent.Core.Server;

/// <summary>
/// Wire-format shape for POST /api/agent/heartbeat. A thin mapping over
/// SystemMetricsSnapshot rather than serializing it directly, mainly so
/// Uptime (a TimeSpan) becomes a plain number of seconds — the server
/// side has no reason to understand .NET's TimeSpan string format.
/// </summary>
// A record (not a plain class) so ServerClient can use a `with`
// expression to layer the current RunningJob onto the snapshot-derived
// payload without a mutable setter.
internal sealed record HeartbeatPayload
{
    public string? Hostname { get; init; }
    public string? Os { get; init; }
    public string? OsVersion { get; init; }
    public string? Architecture { get; init; }
    public double? UptimeSeconds { get; init; }
    public string? AgentVersion { get; init; }
    public CpuSnapshot? Cpu { get; init; }
    public MemorySnapshot? Memory { get; init; }
    public IReadOnlyList<GpuSnapshot>? Gpus { get; init; }
    public IReadOnlyList<DiskSnapshot>? Disks { get; init; }
    public IReadOnlyList<ProcessSnapshot>? Processes { get; init; }
    // P3-2: what job types this Agent can execute — see WorkerCapabilities.
    public IReadOnlyList<string>? Capabilities { get; init; }
    // P3-8: installed software versions, mechanism only — see
    // WorkerSoftwareVersions.
    public IReadOnlyDictionary<string, string>? SoftwareVersions { get; init; }
    // P4-3H: every job this Agent currently has in flight, one per active
    // GPU slot (or a single entry for a CPU-only worker) -- was a single
    // nullable RunningJob before true concurrent per-GPU-slot execution
    // existed (see docs/ROADMAP.md's P4-3H). RunningJob (singular) is
    // kept below too, always sent alongside as the first entry of this
    // list (or omitted if empty), so a server that hasn't been
    // redeployed yet still understands this Agent's heartbeat.
    public IReadOnlyList<RunningJobPayload>? RunningJobs { get; init; }

    // P4-3H legacy: first entry of RunningJobs, or null. Old servers only
    // read this field.
    public RunningJobPayload? RunningJob { get; init; }

    internal sealed record RunningJobPayload
    {
        public int Id { get; init; }
        public int Progress { get; init; }
        // P4-2: only FFmpeg-style jobs report these -- null for "test".
        public double? Fps { get; init; }
        public int? EtaSeconds { get; init; }
    }

    public static HeartbeatPayload FromSnapshot(SystemMetricsSnapshot snapshot) => new()
    {
        Hostname = snapshot.Hostname,
        Os = snapshot.OperatingSystem,
        OsVersion = snapshot.OsVersion,
        Architecture = snapshot.Architecture,
        UptimeSeconds = snapshot.Uptime?.TotalSeconds,
        AgentVersion = snapshot.AgentVersion,
        Cpu = snapshot.Cpu,
        Memory = snapshot.Memory,
        Gpus = snapshot.Gpus,
        Disks = snapshot.Disks,
        Processes = snapshot.Processes,
        Capabilities = WorkerCapabilities.Current,
        SoftwareVersions = WorkerSoftwareVersions.Current,
    };
}
