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
/// P4-2/P4-3H: one runner instance per job type, all driven the same way
/// by Worker.cs — introduced when FfmpegJobRunner became the second
/// implementation alongside TestJobRunner (P3-4). Worker.cs picks a
/// runner by the assigned job's `type` (see Worker.cs's _jobRunners
/// dictionary) rather than special-casing job types itself.
///
/// P4-3H: a runner tracks MULTIPLE concurrent executions internally,
/// keyed by job id — not "one job at a time" (that was P3-4/P4-2's
/// deliberate simplification, see docs/ROADMAP.md's P4-3H for why it had
/// to change: the server already reserves independent GPU slots per job,
/// but the old single-slot-per-runner design meant a second job assigned
/// to a second GPU on the same multi-GPU workstation just sat ASSIGNED
/// until the first one finished — confirmed live against CGI-Render's
/// two RTX 3090s on 2026-09-02). Worker.cs no longer gates starting a new
/// job on any global "busy" flag; the server is the sole authority on
/// not double-booking a GPU slot (job/scheduler.ts), so every runner here
/// just needs to track each job id it's running independently and never
/// let one job's state touch another's.
/// </summary>
public interface IJobRunner
{
    /// <summary>Every job this runner currently knows about — in flight or finished-but-not-yet-reported. Reset(jobId) removes an entry once its result has been reported to the server.</summary>
    IReadOnlyList<JobSnapshot> GetSnapshots();

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
    /// docs/ROADMAP.md's P4-3H. Verified against real concurrent 2-GPU
    /// hardware (CGI-Render, two RTX 3090s) 2026-09-02.
    /// </summary>
    void Start(int jobId, string? inputJson, int? gpuSlot);
    void Cancel(int jobId);

    /// <summary>Call once the caller has reported a finished snapshot's result for this specific job id, to free up its tracking entry.</summary>
    void Reset(int jobId);
}
