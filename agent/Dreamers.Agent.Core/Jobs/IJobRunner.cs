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

    /// <summary>
    /// P4-5 prep: gpuSlot is the GPU index the scheduler reserved this
    /// job's unit on (server/src/job/scheduler.ts's workerUnits/
    /// findAssignment already assign independent GPU slots on a
    /// multi-GPU workstation) -- null for a CPU-only unit or a job type
    /// that doesn't target a GPU. Runners that do GPU work (Ffmpeg/Topaz)
    /// use it to explicitly pin the encoder/model to that device instead
    /// of leaving it to driver-default GPU selection, which could
    /// otherwise land two concurrent jobs on the same physical GPU even
    /// though the scheduler reserved them independent slots -- see
    /// docs/ROADMAP.md's P4-5. Not yet verified against real concurrent
    /// multi-GPU hardware (needs a 2-GPU workstation); implemented and
    /// unit-tested ahead of that verification.
    /// </summary>
    void Start(int jobId, string? inputJson, int? gpuSlot);
    void Cancel(int jobId);

    /// <summary>Call once the caller has reported a finished snapshot's result, to free up capacity for the next job.</summary>
    void Reset();
}
