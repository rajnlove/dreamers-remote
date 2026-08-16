namespace Dreamers.Agent.Core.Worker;

/// <summary>
/// P3-2: what job types this Agent can execute, reported on every
/// heartbeat. Phase 3 only ships a trivial built-in "test" job type
/// (P3-4) to prove the job engine works end-to-end — real capabilities
/// (FFmpeg, Houdini, Topaz, ...) are Phase 4/5's problem, added here
/// once those tools actually get installed/detected on a workstation.
/// </summary>
public static class WorkerCapabilities
{
    public static IReadOnlyList<string> Current { get; } = new[] { "test" };
}
