namespace Dreamers.Agent.Core.Worker;

/// <summary>
/// P3-8: installed software versions, reported on every heartbeat --
/// mechanism only. No real detection logic yet (nothing to detect until
/// Phase 4/5 installs real tools like Houdini/FFmpeg/Octane onto a
/// workstation); a fixed "test" entry exists purely so the scheduler's
/// version-compatibility check (job/scheduler.ts's
/// softwareRequirementsSatisfied) can be exercised end-to-end, the same
/// role WorkerCapabilities' "test" capability plays for job-type
/// matching.
/// </summary>
public static class WorkerSoftwareVersions
{
    public static IReadOnlyDictionary<string, string> Current { get; } =
        new Dictionary<string, string> { ["test"] = "1.0.0" };
}
