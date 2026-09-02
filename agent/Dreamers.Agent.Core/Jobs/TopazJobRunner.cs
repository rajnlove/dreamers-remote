using System.Diagnostics;
using System.Text.Json;
using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Credentials;
using Dreamers.Agent.Core.Ffmpeg;
using Dreamers.Agent.Core.Topaz;

namespace Dreamers.Agent.Core.Jobs;

/// <summary>
/// Phase 4 (P4-4): runs a real "topaz" job -- mirrors
/// Jobs/FfmpegJobRunner.cs almost line-for-line (same allowed-root
/// re-validation, same NAS session re-assertion, same whitelisted
/// ArgumentList build via TopazArgs, same -progress pipe:1 parsing via
/// the SAME FfmpegProgressParser/FfprobeDuration Topaz's ffmpeg build
/// also supports, same exit-code-0-AND-output-exists success rule, same
/// stderr-tail-from-the-end truncation). The one real difference: this
/// invokes Topaz's own proprietary ffmpeg.exe by its configured full
/// path (TopazConfigStore), never the bare "ffmpeg" PATH token, and
/// sets TVAI_MODEL_DIR/TVAI_MODEL_DATA_DIR -- confirmed required by
/// hand-testing the real CLI (P4-4 planning): without them, "tvai_up"
/// fails with "Model not found" even for an already-downloaded model.
/// </summary>
public sealed class TopazJobRunner : IJobRunner
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private readonly AllowedPathsConfigStore _allowedPathsStore;
    private readonly NasCredentialStore _nasCredentialStore;
    private readonly TopazConfigStore _topazConfigStore;
    private readonly object _lock = new();
    private readonly Dictionary<int, JobSnapshot> _jobs = new();
    private readonly Dictionary<int, Process> _processes = new();

    public TopazJobRunner(AllowedPathsConfigStore allowedPathsStore, NasCredentialStore nasCredentialStore, TopazConfigStore topazConfigStore)
    {
        _allowedPathsStore = allowedPathsStore;
        _nasCredentialStore = nasCredentialStore;
        _topazConfigStore = topazConfigStore;
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
            // See FfmpegJobRunner.RunAsync's identical comment -- same
            // Start()/IsBusy race this guards against.
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

            var topazConfig = _topazConfigStore.LoadOrCreate();
            var args = TopazArgs.Build(input, gpuSlot);
            var durationSeconds = FfprobeDuration.TryGetSeconds(input.SourcePath);
            var startedAt = DateTime.UtcNow;

            var psi = new ProcessStartInfo(topazConfig.FfmpegPath)
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            foreach (var arg in args) psi.ArgumentList.Add(arg);
            // Required for "tvai_up" to find/cache model weights -- see
            // this class's doc comment. Machine-wide directory (not
            // per-user), so it works identically whether this runs
            // interactively or as the LocalSystem service.
            psi.EnvironmentVariables["TVAI_MODEL_DIR"] = topazConfig.ModelDir;
            psi.EnvironmentVariables["TVAI_MODEL_DATA_DIR"] = topazConfig.ModelDir;

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
                    ? $"topaz ffmpeg exited with code {exitCode}: {errorTail}"
                    : $"topaz ffmpeg exited 0 but output file was not created: \"{input.OutputPath}\"";
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

    private static TopazJobInput ParseInput(string? inputJson)
    {
        if (string.IsNullOrWhiteSpace(inputJson))
        {
            throw new InvalidOperationException("topaz job has no input");
        }
        return JsonSerializer.Deserialize<TopazJobInput>(inputJson, JsonOptions)
            ?? throw new InvalidOperationException("topaz job input did not deserialize");
    }

    // Same end-of-string truncation as FfmpegJobRunner, same reason:
    // ffmpeg's own long configuration banner opens stderr, the real
    // error is always further down.
    private static string Truncate(string s) => s.Length <= 2000 ? s : s[^2000..];
}
