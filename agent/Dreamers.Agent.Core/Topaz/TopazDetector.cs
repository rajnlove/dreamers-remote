using System.Diagnostics;
using System.Text.RegularExpressions;
using Dreamers.Agent.Core.Configuration;

namespace Dreamers.Agent.Core.Topaz;

public sealed record TopazInfo(bool Available, string? Version);

/// <summary>
/// Phase 4 (P4-4): real capability detection for the "topaz" job type,
/// mirroring Ffmpeg/FfmpegDetector.cs -- except this one needs a
/// TopazConfig (where Topaz's proprietary ffmpeg.exe actually lives),
/// which it can't construct itself, so unlike FfmpegDetector it does
/// NOT own its own Lazy cache; WorkerCapabilities does that (same
/// reasoning as NasHealthChecker.Check, which also takes DI-provided
/// stores it can't construct itself -- see WorkerCapabilities.LazyTopazInfo).
///
/// Runs Topaz's own bundled ffmpeg.exe by its configured full path,
/// never a bare "ffmpeg" PATH lookup -- a workstation with both job
/// types installed would otherwise have two different ffmpeg.exe's
/// ambiguously fighting over the same PATH entry. Confirms the
/// "tvai_up" filter is actually present in -filters output -- proves
/// this really is Topaz's build at the configured path, not a stray
/// generic ffmpeg someone pointed the config at.
/// </summary>
public static class TopazDetector
{
    private static readonly Regex VersionPattern = new(@"ffmpeg version (\S+)", RegexOptions.Compiled);

    public static TopazInfo Detect(TopazConfig config)
    {
        var versionOutput = TryRun(config.FfmpegPath, "-version");
        if (versionOutput is null)
        {
            return new TopazInfo(Available: false, Version: null);
        }

        var filtersOutput = TryRun(config.FfmpegPath, "-hide_banner -filters") ?? string.Empty;
        if (!filtersOutput.Contains("tvai_up", StringComparison.Ordinal))
        {
            // A binary exists at the configured path but isn't actually
            // Topaz's tvai-enabled build -- don't advertise "topaz".
            return new TopazInfo(Available: false, Version: null);
        }

        var match = VersionPattern.Match(versionOutput);
        var version = match.Success ? match.Groups[1].Value : "unknown";
        return new TopazInfo(Available: true, Version: version);
    }

    // Same contract as FfmpegDetector.TryRun: null on any failure, never
    // throws up into the Agent's heartbeat loop.
    private static string? TryRun(string fileName, string arguments)
    {
        try
        {
            var psi = new ProcessStartInfo(fileName, arguments)
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var process = Process.Start(psi);
            if (process is null) return null;

            var stdout = process.StandardOutput.ReadToEnd();
            var stderr = process.StandardError.ReadToEnd();
            if (!process.WaitForExit(TimeSpan.FromSeconds(10)))
            {
                try { process.Kill(entireProcessTree: true); } catch { /* best effort */ }
                return null;
            }
            return stdout + stderr;
        }
        catch (Exception)
        {
            // Most commonly Win32Exception (nothing at the configured
            // FfmpegPath) -- any failure here just means "not available".
            return null;
        }
    }
}
