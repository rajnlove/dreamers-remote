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

    public void Start(int jobId, string? inputJson)
    {
        lock (_lock)
        {
            if (_current is not null && !_current.Finished)
            {
                throw new InvalidOperationException("A job is already running.");
            }
            _current = new Snapshot(jobId, 0, Finished: false, Success: false, Error: null);
        }

        var seconds = ParseSeconds(inputJson);
        _ = RunAsync(jobId, seconds);
    }

    private async Task RunAsync(int jobId, int seconds)
    {
        try
        {
            for (var elapsed = 1; elapsed <= seconds; elapsed++)
            {
                await Task.Delay(TimeSpan.FromSeconds(1));
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
