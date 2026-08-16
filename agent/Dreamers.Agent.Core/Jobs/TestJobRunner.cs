using System.Text.Json;

namespace Dreamers.Agent.Core.Jobs;

/// <summary>
/// P3-4: runs the built-in "test" job type — sleep N seconds (from
/// input JSON <c>{"seconds": N}</c>, default 5), reporting progress
/// 0-100 as it goes — to prove the whole job engine loop works
/// end-to-end with no real workload attached. Real job types
/// (FFmpeg, Houdini, ...) are Phase 4/5's problem; they'd be separate
/// executors, not more branches in this class.
///
/// Deliberately only runs one job at a time, even on a multi-GPU
/// workstation that could in principle have several ASSIGNED jobs
/// simultaneously (see server's job/repository.ts
/// getAssignedJobForWorker comment) — true concurrent multi-slot
/// execution is a later polish item, not this milestone's scope.
/// </summary>
public sealed class TestJobRunner
{
    private const int DefaultSeconds = 5;

    public sealed record Snapshot(int JobId, int Progress, bool Finished, bool Success, string? Error);

    private readonly object _lock = new();
    private Snapshot? _current;
    private CancellationTokenSource? _cts;

    public bool IsBusy
    {
        get
        {
            lock (_lock) return _current is not null && !_current.Finished;
        }
    }

    public Snapshot? GetSnapshot()
    {
        lock (_lock) return _current;
    }

    /// <summary>Call once the caller has reported a finished snapshot's result, to free up capacity for the next job.</summary>
    public void Reset()
    {
        lock (_lock) _current = null;
    }

    // P3-5: the server tells the Agent to stop via the next heartbeat
    // response (POST /api/jobs/:id/cancel already flipped it to
    // CANCELLED server-side) — this doesn't report anything back, there's
    // nothing to report, the server is already authoritative. A no-op if
    // jobId doesn't match what's currently running (e.g. a stale/late
    // cancel signal for a job that already finished on its own).
    public void Cancel(int jobId)
    {
        lock (_lock)
        {
            if (_current is { Finished: false } c && c.JobId == jobId)
            {
                _cts?.Cancel();
            }
        }
    }

    public void Start(int jobId, string? inputJson)
    {
        CancellationToken token;
        lock (_lock)
        {
            if (_current is not null && !_current.Finished)
            {
                throw new InvalidOperationException("A job is already running.");
            }
            _current = new Snapshot(jobId, 0, Finished: false, Success: false, Error: null);
            _cts = new CancellationTokenSource();
            token = _cts.Token;
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
                    if (_current is { } c && c.JobId == jobId)
                    {
                        _current = c with { Progress = progress };
                    }
                }
            }
            lock (_lock)
            {
                if (_current is { } c && c.JobId == jobId)
                {
                    _current = c with { Progress = 100, Finished = true, Success = true };
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Cancel() already told us why — clear straight to idle rather
            // than a Finished snapshot; there's nothing for Worker.cs to
            // report, the server is already authoritative on this job.
            lock (_lock)
            {
                if (_current is { } c && c.JobId == jobId)
                {
                    _current = null;
                }
            }
        }
        catch (Exception ex)
        {
            lock (_lock)
            {
                if (_current is { } c && c.JobId == jobId)
                {
                    _current = c with { Finished = true, Success = false, Error = ex.Message };
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
