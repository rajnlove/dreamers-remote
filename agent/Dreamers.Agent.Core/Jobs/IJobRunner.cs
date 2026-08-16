namespace Dreamers.Agent.Core.Jobs;

/// <summary>
/// P4-2: shared snapshot shape across job runner types (TestJobRunner,
/// FfmpegJobRunner, ...). Fps/EtaSeconds are null for job types that
/// don't have a meaningful encode/render rate (e.g. "test").
/// </summary>
public sealed record JobSnapshot(int JobId, int Progress, double? Fps, int? EtaSeconds, bool Finished, bool Success, string? Error)
{
    public static JobSnapshot Starting(int jobId) => new(jobId, 0, null, null, Finished: false, Success: false, Error: null);
}

/// <summary>
/// P4-2: one runner per job type, all driven the same way by Worker.cs
/// — introduced when FfmpegJobRunner became the second implementation
/// alongside TestJobRunner (P3-4). Worker.cs picks a runner by the
/// assigned job's `type` (see Worker.cs's _jobRunners dictionary)
/// rather than special-casing job types itself.
/// </summary>
public interface IJobRunner
{
    bool IsBusy { get; }
    JobSnapshot? GetSnapshot();
    void Start(int jobId, string? inputJson);
    void Cancel(int jobId);

    /// <summary>Call once the caller has reported a finished snapshot's result, to free up capacity for the next job.</summary>
    void Reset();
}
