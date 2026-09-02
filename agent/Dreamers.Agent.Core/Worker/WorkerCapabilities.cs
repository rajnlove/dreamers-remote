using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Credentials;
using Dreamers.Agent.Core.Ffmpeg;
using Dreamers.Agent.Core.Topaz;

namespace Dreamers.Agent.Core.Worker;

/// <summary>
/// What job types this Agent can execute, reported on every heartbeat.
/// "test" (P3-2) is always present to prove the job engine loop itself.
/// "ffmpeg" (P4-1) is added only when FfmpegDetector actually finds a
/// working ffmpeg.exe on this machine AND (P4-3) NasHealthChecker
/// confirms the dedicated NAS credential can authenticate to, read, and
/// write the configured allowed root -- advertising "ffmpeg" without a
/// working NAS session would just get jobs assigned here that fail
/// immediately on every sourcePath/outputPath. "topaz" (P4-4) is the
/// same idea: TopazDetector finds Topaz's own proprietary ffmpeg.exe
/// AND the same NAS health check passes (a topaz job also reads/writes
/// the NAS -- one shared NAS session serves every job type, see
/// TopazConfig's doc comment).
///
/// P4-3H: NasHealth/TopazInfo used to be Lazy&lt;T&gt; -- computed ONCE,
/// ever, per process lifetime. That meant a NAS check that happened to
/// fail at the exact moment the Agent started (e.g. right after a
/// restart, before the machine's own network/SMB stack was fully back up
/// — the working theory for CGI-Render/COMP-01's "ffmpeg" capability
/// silently vanishing on 2026-09-02) would stay permanently "unhealthy"
/// for that entire process's life, never re-checked even after the NAS
/// became reachable again seconds later — the only fix was a full
/// service restart. Now both are re-checked periodically (see
/// RefreshInterval) so a transient failure at startup self-heals within
/// one refresh window instead of requiring manual intervention.
/// </summary>
public static class WorkerCapabilities
{
    // A real SMB auth + directory-list + write-probe round trip -- not
    // free, so this is deliberately much coarser than the 5s heartbeat
    // interval (P4-3H's whole point is "eventually notices and heals",
    // not "notices instantly"). 2 minutes is a few heartbeats' worth of
    // "ffmpeg missing" on the dashboard before it self-corrects, which is
    // an acceptable tradeoff against hammering the NAS with a full
    // read/write probe every tick.
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromMinutes(2);

    private static readonly object _lock = new();
    private static NasCredentialStore? _nasCredentialStore;
    private static AllowedPathsConfigStore? _allowedPathsStore;
    private static TopazConfigStore? _topazConfigStore;

    private static NasHealthResult? _cachedNasHealth;
    private static DateTime _nasHealthCheckedAtUtc;
    private static TopazInfo? _cachedTopazInfo;
    private static DateTime _topazCheckedAtUtc;

    /// <summary>Must be called once, before the first heartbeat, so the checks below have the stores they need — see Program.cs.</summary>
    public static void Initialize(NasCredentialStore nasCredentialStore, AllowedPathsConfigStore allowedPathsStore, TopazConfigStore topazConfigStore)
    {
        _nasCredentialStore = nasCredentialStore;
        _allowedPathsStore = allowedPathsStore;
        _topazConfigStore = topazConfigStore;
    }

    /// <summary>The NAS health check's result, refreshed at most every RefreshInterval — exposed so Worker.cs can log the specific authentication/permission/network reason, not just silently omit "ffmpeg"/"topaz" from Capabilities.</summary>
    public static NasHealthResult NasHealth
    {
        get
        {
            lock (_lock)
            {
                if (_cachedNasHealth is null || DateTime.UtcNow - _nasHealthCheckedAtUtc > RefreshInterval)
                {
                    _cachedNasHealth = _nasCredentialStore is null || _allowedPathsStore is null
                        ? new NasHealthResult(NasConnectCategory.NotConfigured, "WorkerCapabilities.Initialize was never called.")
                        : NasHealthChecker.Check(_nasCredentialStore, _allowedPathsStore);
                    _nasHealthCheckedAtUtc = DateTime.UtcNow;
                }
                return _cachedNasHealth;
            }
        }
    }

    /// <summary>Topaz detection's result, refreshed at most every RefreshInterval — exposed so Worker.cs can log why "topaz" is absent, same reasoning as NasHealth.</summary>
    public static TopazInfo TopazInfo
    {
        get
        {
            lock (_lock)
            {
                if (_cachedTopazInfo is null || DateTime.UtcNow - _topazCheckedAtUtc > RefreshInterval)
                {
                    _cachedTopazInfo = _topazConfigStore is null
                        ? new TopazInfo(Available: false, Version: null)
                        : TopazDetector.Detect(_topazConfigStore.LoadOrCreate());
                    _topazCheckedAtUtc = DateTime.UtcNow;
                }
                return _cachedTopazInfo;
            }
        }
    }

    public static IReadOnlyList<string> Current
    {
        get
        {
            var capabilities = new List<string> { "test" };
            if (FfmpegDetector.Current.Available && NasHealth.Ok)
            {
                capabilities.Add("ffmpeg");
            }
            if (TopazInfo.Available && NasHealth.Ok)
            {
                capabilities.Add("topaz");
            }
            return capabilities;
        }
    }
}
