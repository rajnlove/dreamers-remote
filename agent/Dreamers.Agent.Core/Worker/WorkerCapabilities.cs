using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Credentials;
using Dreamers.Agent.Core.Ffmpeg;

namespace Dreamers.Agent.Core.Worker;

/// <summary>
/// What job types this Agent can execute, reported on every heartbeat.
/// "test" (P3-2) is always present to prove the job engine loop itself.
/// "ffmpeg" (P4-1) is added only when FfmpegDetector actually finds a
/// working ffmpeg.exe on this machine AND (P4-3) NasHealthChecker
/// confirms the dedicated NAS credential can authenticate to, read, and
/// write the configured allowed root -- advertising "ffmpeg" without a
/// working NAS session would just get jobs assigned here that fail
/// immediately on every sourcePath/outputPath.
/// </summary>
public static class WorkerCapabilities
{
    private static NasCredentialStore? _nasCredentialStore;
    private static AllowedPathsConfigStore? _allowedPathsStore;
    private static readonly Lazy<NasHealthResult> LazyNasHealth = new(() =>
        _nasCredentialStore is null || _allowedPathsStore is null
            ? new NasHealthResult(NasConnectCategory.NotConfigured, "WorkerCapabilities.Initialize was never called.")
            : NasHealthChecker.Check(_nasCredentialStore, _allowedPathsStore));

    /// <summary>Must be called once, before the first heartbeat, so the Lazy NAS health check above has the stores it needs — see Program.cs.</summary>
    public static void Initialize(NasCredentialStore nasCredentialStore, AllowedPathsConfigStore allowedPathsStore)
    {
        _nasCredentialStore = nasCredentialStore;
        _allowedPathsStore = allowedPathsStore;
    }

    /// <summary>The NAS health check's result, computed once and cached — exposed so Worker.cs can log the specific authentication/permission/network reason at startup, not just silently omit "ffmpeg" from Capabilities.</summary>
    public static NasHealthResult NasHealth => LazyNasHealth.Value;

    public static IReadOnlyList<string> Current
    {
        get
        {
            var capabilities = new List<string> { "test" };
            if (FfmpegDetector.Current.Available && NasHealth.Ok)
            {
                capabilities.Add("ffmpeg");
            }
            return capabilities;
        }
    }
}
