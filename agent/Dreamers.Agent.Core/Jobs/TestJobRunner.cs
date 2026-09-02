using System.Text.Json;

namespace Dreamers.Agent.Core.Jobs;

/// <summary>
/// P3-4: runs the built-in "test" job type — sleep N seconds (from
/// input JSON <c>{"seconds": N}</c>, default 5), reporting progress
/// 0-100 as it goes — to prove the whole job engine loop works
/// end-to-end with no real workload attached. Real job types (P4-2's
/// FfmpegJobRunner, ...) are separate IJobRunner implementations, not
/// more branches in this class.
///
/// P4-3H: tracks each concurrently-running job independently, keyed by
/// job id, instead of the old single-job-at-a-time restriction — see
/// IJobRunner's doc comment for why that changed.
/// </summary>
public sealed class TestJobRunner : IJobRunner
{
    private const int DefaultSeconds = 5;

    private readonly object _lock = new();
    private readonly Dictionary<int, JobSnapshot> _jobs = new();
    private readonly Dictionary<int, CancellationTokenSource> _cts = new();

    public IReadOnlyList<JobSnapshot> GetSnapshots()
    {
        lock (_lock) return _jobs.Values.ToList();
    }

    public void Reset(int jobId)
    {
        lock (_lock)
        {
            _jobs.Remove(jobId);
            _cts.Remove(jobId);
        }
    }

    // P3-5: the server tells the Agent to stop via the next heartbeat
    // response (POST /api/jobs/:id/cancel already flipped it to
    // CANCELLED server-side) — this doesn't report anything back, there's
    // nothing to report, the server is already authoritative. A no-op if
    // jobId doesn't match anything currently tracked (e.g. a stale/late
    // cancel signal for a job that already finished on its own).
    public void Cancel(int jobId)
    {
        lock (_lock)
        {
            if (_jobs.TryGetValue(jobId, out var c) && !c.Finished && _cts.TryGetValue(jobId, out var cts))
            {
                cts.Cancel();
            }
        }
    }

    // gpuSlot is unused -- "test" is a synthetic sleep loop, no real GPU
    // work to pin to a device (see IJobRunner.Start's doc comment).
    public void Start(int jobId, string? inputJson, int? gpuSlot)
    {
        CancellationToken token;
        lock (_lock)
        {
            if (_jobs.TryGetValue(jobId, out var existing) && !existing.Finished)
            {
                throw new InvalidOperationException($"Job {jobId} is already running.");
            }
            _jobs[jobId] = JobSnapshot.Starting(jobId);
            var cts = new CancellationTokenSource();
            _cts[jobId] = cts;
            token = cts.Token;
        }

        var seconds = ParseSeconds(inputJson);
        _ = RunAsync(jobId, seconds, token);
    }

    private async Task RunAsync(int jobId, int seconds, CancellationToken cancellationToken)
    {
        try
        {
            for (var elapsed = 1; elapsed <= seconds; elapsed++)
            {
                await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
                var progress = (int)(elapsed * 100.0 / seconds);
                lock (_lock)
                {
                    if (_jobs.TryGetValue(jobId, out var c))
                    {
                        _jobs[jobId] = c with { Progress = progress };
                    }
                }
            }
            lock (_lock)
            {
                if (_jobs.TryGetValue(jobId, out var c))
                {
                    _jobs[jobId] = c with { Progress = 100, Finished = true, Success = true };
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Cancel() already told us why — clear straight out rather
            // than leaving a Finished snapshot; there's nothing for
            // Worker.cs to report, the server is already authoritative
            // on this job.
            lock (_lock)
            {
                _jobs.Remove(jobId);
                _cts.Remove(jobId);
            }
        }
        catch (Exception ex)
        {
            lock (_lock)
            {
                if (_jobs.TryGetValue(jobId, out var c))
                {
                    _jobs[jobId] = c with { Finished = true, Success = false, Error = ex.Message };
                }
            }
        }
    }

    private static int ParseSeconds(string? inputJson)
    {
        if (string.IsNullOrWhiteSpace(inputJson)) return DefaultSeconds;
        try
        {
            using var doc = JsonDocument.Parse(inputJson);
            if (doc.RootElement.TryGetProperty("seconds", out var el) && el.TryGetInt32(out var s) && s > 0)
            {
                return s;
            }
        }
        catch (JsonException)
        {
            // Malformed input — fall through to the default rather than fail the job outright.
        }
        return DefaultSeconds;
    }
}
