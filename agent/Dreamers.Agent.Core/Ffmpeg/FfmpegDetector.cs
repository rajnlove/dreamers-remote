using System.Diagnostics;
using System.Text.RegularExpressions;

namespace Dreamers.Agent.Core.Ffmpeg;

public sealed record FfmpegInfo(bool Available, string? Version, IReadOnlyList<string> NvencEncoders);

/// <summary>
/// Phase 4 (P4-1): real capability detection, replacing P3-2's hardcoded
/// placeholder for this one capability — checks whether ffmpeg.exe is
/// actually on PATH and which NVENC encoders its build reports
/// supporting (h264_nvenc/hevc_nvenc/av1_nvenc). Doesn't verify a given
/// GPU/driver can actually *use* an encoder at runtime — ffmpeg itself
/// will fail clearly (surfaced as a job FAILED with its stderr) if a
/// reported encoder turns out not to work on this hardware; that's an
/// acceptable failure mode rather than something to pre-validate here.
///
/// Computed once per Agent process lifetime (Lazy) rather than on every
/// heartbeat — spawning ffmpeg -version/-encoders every 5s would be
/// wasteful, and an install doesn't change while the service is running.
/// </summary>
public static class FfmpegDetector
{
    private static readonly Lazy<FfmpegInfo> LazyInfo = new(Detect);
    private static readonly Regex VersionPattern = new(@"ffmpeg version (\S+)", RegexOptions.Compiled);
    private static readonly string[] NvencCandidates = { "h264_nvenc", "hevc_nvenc", "av1_nvenc" };

    public static FfmpegInfo Current => LazyInfo.Value;

    private static FfmpegInfo Detect()
    {
        var versionOutput = TryRun("ffmpeg", "-version");
        if (versionOutput is null)
        {
            return new FfmpegInfo(Available: false, Version: null, NvencEncoders: Array.Empty<string>());
        }

        var match = VersionPattern.Match(versionOutput);
        var version = match.Success ? match.Groups[1].Value : "unknown";

        var encodersOutput = TryRun("ffmpeg", "-hide_banner -encoders") ?? string.Empty;
        var nvenc = NvencCandidates.Where(name => encodersOutput.Contains(name, StringComparison.Ordinal)).ToList();

        return new FfmpegInfo(Available: true, Version: version, NvencEncoders: nvenc);
    }

    // Null on any failure (not found, non-zero exit that still matters,
    // timeout) — the caller treats that as "ffmpeg isn't usable here",
    // never throws up into the Agent's heartbeat loop.
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

            // ffmpeg -version/-encoders write to stdout; some builds also
            // echo banner info to stderr -- concatenate both so the
            // version regex/encoder-name search sees everything either
            // way, rather than guessing which stream a given build uses.
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
            // Most commonly Win32Exception (ffmpeg.exe not found on PATH)
            // — any failure here just means "not available", not a crash.
            return null;
        }
    }
}
