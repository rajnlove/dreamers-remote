using System.Diagnostics;
using System.Text.Json;
using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Credentials;
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
/// P4-3H: tracks each concurrently-running job independently, keyed by
/// job id, instead of the old single-job-at-a-time restriction -- lets
/// two ffmpeg jobs (or one ffmpeg + one topaz) actually run at once on
/// two different GPUs of the same workstation. See IJobRunner's doc
/// comment for why that changed.
/// </summary>
public sealed class FfmpegJobRunner : IJobRunner
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private readonly AllowedPathsConfigStore _allowedPathsStore;
    private readonly NasCredentialStore _nasCredentialStore;
    private readonly object _lock = new();
    private readonly Dictionary<int, JobSnapshot> _jobs = new();
    private readonly Dictionary<int, Process> _processes = new();

    public FfmpegJobRunner(AllowedPathsConfigStore allowedPathsStore, NasCredentialStore nasCredentialStore)
    {
        _allowedPathsStore = allowedPathsStore;
        _nasCredentialStore = nasCredentialStore;
    }

    public IReadOnlyList<JobSnapshot> GetSnapshots()
    {
        lock (_lock) return _jobs.Values.ToList();
    }

    public void Reset(int jobId)
    {
        lock (_lock)
        {
            _jobs.Remove(jobId);
            _processes.Remove(jobId);
        }
    }

    public void Cancel(int jobId)
    {
        Process? toKill = null;
        lock (_lock)
        {
            if (_jobs.TryGetValue(jobId, out var c) && !c.Finished)
            {
                _processes.TryGetValue(jobId, out toKill);
            }
        }
        // Killed outside the lock -- Process.Kill can block briefly and
        // must never do so while holding a lock the progress-reader
        // thread also needs.
        try { toKill?.Kill(entireProcessTree: true); } catch { /* already exited */ }
    }

    public void Start(int jobId, string? inputJson, int? gpuSlot)
    {
        lock (_lock)
        {
            if (_jobs.TryGetValue(jobId, out var existing) && !existing.Finished)
            {
                throw new InvalidOperationException($"Job {jobId} is already running.");
            }
            _jobs[jobId] = JobSnapshot.Starting(jobId);
        }

        _ = RunAsync(jobId, inputJson, gpuSlot);
    }

    private async Task RunAsync(int jobId, string? inputJson, int? gpuSlot)
    {
        try
        {
            // Guarantees Start() has already returned (and its synchronous
            // "_jobs[jobId] = JobSnapshot.Starting(...)" has already
            // taken effect) before any of this method's body runs --
            // without this, a synchronously-thrown validation error below
            // (bad path, no allowed roots configured, ...) could complete
            // this whole async method before Start()'s caller regains
            // control, making GetSnapshots() unreliable immediately after
            // Start() for fast-failing input. See FfmpegJobRunnerTests
            // for the race this was caught by.
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

            // P4-3: LocalSystem (the service account) has no SMB session
            // of its own to a UNC root — re-assert the dedicated NAS
            // credential's session before touching the filesystem.
            // Best-effort/no-op if unconfigured or already connected; a
            // genuine failure here still surfaces as the existing
            // "sourcePath does not exist" error just below, since an
            // unauthenticated UNC path and a missing one look identical
            // to File.Exists().
            NasConnector.TryEnsureConnected(input.SourcePath, _nasCredentialStore);
            NasConnector.TryEnsureConnected(input.OutputPath, _nasCredentialStore);

            if (!File.Exists(input.SourcePath))
            {
                throw new InvalidOperationException($"sourcePath does not exist: \"{input.SourcePath}\"");
            }

            var outputDir = Path.GetDirectoryName(input.OutputPath);
            if (!string.IsNullOrEmpty(outputDir))
            {
                Directory.CreateDirectory(outputDir);
            }

            var args = FfmpegArgs.Build(input, gpuSlot);
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
            lock (_lock) { _processes[jobId] = process; }

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
            lock (_lock) { _processes.Remove(jobId); }

            if (exitCode == 0 && outputExists)
            {
                lock (_lock)
                {
                    if (_jobs.TryGetValue(jobId, out var c))
                    {
                        _jobs[jobId] = c with { Progress = 100, Finished = true, Success = true };
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
                    if (_jobs.TryGetValue(jobId, out var c))
                    {
                        _jobs[jobId] = c with { Finished = true, Success = false, Error = Truncate(error) };
                    }
                }
            }
        }
        catch (Exception ex)
        {
            lock (_lock)
            {
                _processes.Remove(jobId);
                if (_jobs.TryGetValue(jobId, out var c))
                {
                    _jobs[jobId] = c with { Finished = true, Success = false, Error = Truncate(ex.Message) };
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
            if (_jobs.TryGetValue(jobId, out var c) && !c.Finished)
            {
                _jobs[jobId] = c with
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

    // Keeps the END of the string, not the start -- ffmpeg's stderr
    // opens with a very long single "configuration: --enable-..." line
    // (its own build-flag banner) before anything about the actual
    // failure, which is always further down/at the end. Truncating from
    // the front (as this originally did) could eat the entire 2000-char
    // budget on that one banner line and never show the real error --
    // caught via a real ffmpeg run failing on an NVENC driver-version
    // mismatch where this is exactly what happened.
    private static string Truncate(string s) => s.Length <= 2000 ? s : s[^2000..];
}
