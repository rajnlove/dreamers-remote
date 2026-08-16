using System.Diagnostics;
using System.Text.Json;
using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Ffmpeg;

namespace Dreamers.Agent.Core.Jobs;

/// <summary>
/// Phase 4 (P4-2): runs a real "ffmpeg" job -- validates the job's
/// sourcePath/outputPath are under a configured allowed root
/// (independent of the server's own check, see PathValidator), confirms
/// the source file exists, builds a whitelisted argument list
/// (FfmpegArgs -- never a caller-supplied raw command), runs ffmpeg.exe
/// with progress piped to stdout in machine-readable form
/// (FfmpegProgressParser), reports progress/fps/eta back through the
/// same Snapshot shape TestJobRunner uses, and only reports success if
/// ffmpeg exited 0 AND the output file actually exists afterward.
///
/// Same "one job at a time" simplification as TestJobRunner (see its
/// doc comment) -- Worker.cs is what actually enforces that across all
/// registered IJobRunners, not this class individually.
/// </summary>
public sealed class FfmpegJobRunner : IJobRunner
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private readonly AllowedPathsConfigStore _allowedPathsStore;
    private readonly object _lock = new();
    private JobSnapshot? _current;
    private Process? _process;

    public FfmpegJobRunner(AllowedPathsConfigStore allowedPathsStore)
    {
        _allowedPathsStore = allowedPathsStore;
    }

    public bool IsBusy
    {
        get { lock (_lock) return _current is not null && !_current.Finished; }
    }

    public JobSnapshot? GetSnapshot()
    {
        lock (_lock) return _current;
    }

    public void Reset()
    {
        lock (_lock) _current = null;
    }

    public void Cancel(int jobId)
    {
        Process? toKill = null;
        lock (_lock)
        {
            if (_current is { Finished: false } c && c.JobId == jobId)
            {
                toKill = _process;
            }
        }
        // Killed outside the lock -- Process.Kill can block briefly and
        // must never do so while holding a lock the progress-reader
        // thread also needs.
        try { toKill?.Kill(entireProcessTree: true); } catch { /* already exited */ }
    }

    public void Start(int jobId, string? inputJson)
    {
        lock (_lock)
        {
            if (_current is not null && !_current.Finished)
            {
                throw new InvalidOperationException("A job is already running.");
            }
            _current = JobSnapshot.Starting(jobId);
        }

        _ = RunAsync(jobId, inputJson);
    }

    private async Task RunAsync(int jobId, string? inputJson)
    {
        try
        {
            // Guarantees Start() has already returned (and its synchronous
            // "_current = JobSnapshot.Starting(...)" has already taken
            // effect) before any of this method's body runs -- without
            // this, a synchronously-thrown validation error below (bad
            // path, no allowed roots configured, ...) could complete this
            // whole async method before Start()'s caller regains control,
            // making IsBusy unreliable immediately after Start() for
            // fast-failing input. See FfmpegJobRunnerTests for the race
            // this was caught by.
            await Task.Yield();

            var input = ParseInput(inputJson);
            var allowedRoots = _allowedPathsStore.LoadOrCreate().AllowedRoots;

            if (!PathValidator.IsUnderAllowedRoot(input.SourcePath, allowedRoots))
            {
                throw new InvalidOperationException($"sourcePath is not under an allowed root: \"{input.SourcePath}\"");
            }
            if (!PathValidator.IsUnderAllowedRoot(input.OutputPath, allowedRoots))
            {
                throw new InvalidOperationException($"outputPath is not under an allowed root: \"{input.OutputPath}\"");
            }
            if (!File.Exists(input.SourcePath))
            {
                throw new InvalidOperationException($"sourcePath does not exist: \"{input.SourcePath}\"");
            }

            var outputDir = Path.GetDirectoryName(input.OutputPath);
            if (!string.IsNullOrEmpty(outputDir))
            {
                Directory.CreateDirectory(outputDir);
            }

            var args = FfmpegArgs.Build(input);
            var durationSeconds = FfprobeDuration.TryGetSeconds(input.SourcePath);
            var startedAt = DateTime.UtcNow;

            var psi = new ProcessStartInfo("ffmpeg")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            foreach (var arg in args) psi.ArgumentList.Add(arg);

            using var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
            lock (_lock) { _process = process; }

            var stderrTail = new List<string>();
            process.ErrorDataReceived += (_, e) =>
            {
                if (e.Data is null) return;
                lock (stderrTail)
                {
                    stderrTail.Add(e.Data);
                    if (stderrTail.Count > 40) stderrTail.RemoveAt(0);
                }
            };

            var parser = new FfmpegProgressParser();
            process.OutputDataReceived += (_, e) =>
            {
                if (e.Data is null) return;
                var update = parser.FeedLine(e.Data);
                if (update is null) return;
                ApplyProgress(jobId, update, durationSeconds, startedAt);
            };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            await process.WaitForExitAsync();

            var exitCode = process.ExitCode;
            var outputExists = File.Exists(input.OutputPath);
            lock (_lock) { _process = null; }

            if (exitCode == 0 && outputExists)
            {
                lock (_lock)
                {
                    if (_current is { } c && c.JobId == jobId)
                    {
                        _current = c with { Progress = 100, Finished = true, Success = true };
                    }
                }
            }
            else
            {
                string errorTail;
                lock (stderrTail) { errorTail = string.Join('\n', stderrTail); }
                var error = exitCode != 0
                    ? $"ffmpeg exited with code {exitCode}: {errorTail}"
                    : $"ffmpeg exited 0 but output file was not created: \"{input.OutputPath}\"";
                lock (_lock)
                {
                    if (_current is { } c && c.JobId == jobId)
                    {
                        _current = c with { Finished = true, Success = false, Error = Truncate(error) };
                    }
                }
            }
        }
        catch (Exception ex)
        {
            lock (_lock) { _process = null; }
            lock (_lock)
            {
                if (_current is { } c && c.JobId == jobId)
                {
                    _current = c with { Finished = true, Success = false, Error = Truncate(ex.Message) };
                }
            }
        }
    }

    private void ApplyProgress(int jobId, FfmpegProgressUpdate update, double? durationSeconds, DateTime startedAt)
    {
        int? progress = null;
        int? etaSeconds = null;

        if (durationSeconds is { } total && total > 0 && update.OutTimeSeconds is { } outSeconds)
        {
            var fraction = Math.Clamp(outSeconds / total, 0, 1);
            progress = (int)(fraction * 100);
            var elapsedWall = (DateTime.UtcNow - startedAt).TotalSeconds;
            if (fraction > 0.001)
            {
                etaSeconds = (int)Math.Max(0, elapsedWall * (1 - fraction) / fraction);
            }
        }

        lock (_lock)
        {
            if (_current is { } c && c.JobId == jobId && !c.Finished)
            {
                _current = c with
                {
                    Progress = progress ?? c.Progress,
                    Fps = update.Fps ?? c.Fps,
                    EtaSeconds = etaSeconds ?? c.EtaSeconds,
                };
            }
        }
    }

    private static FfmpegJobInput ParseInput(string? inputJson)
    {
        if (string.IsNullOrWhiteSpace(inputJson))
        {
            throw new InvalidOperationException("ffmpeg job has no input");
        }
        return JsonSerializer.Deserialize<FfmpegJobInput>(inputJson, JsonOptions)
            ?? throw new InvalidOperationException("ffmpeg job input did not deserialize");
    }

    private static string Truncate(string s) => s.Length <= 2000 ? s : s[..2000];
}
