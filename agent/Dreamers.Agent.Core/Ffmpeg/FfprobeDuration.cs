using System.Diagnostics;
using System.Globalization;

namespace Dreamers.Agent.Core.Ffmpeg;

/// <summary>
/// Total source duration, needed to turn ffmpeg's raw out_time_us
/// progress figure into a percentage. Null on any failure (ffprobe not
/// found, unreadable file, timeout) -- FfmpegJobRunner degrades to
/// reporting fps without a percentage/ETA rather than failing the job
/// outright over a duration-probe hiccup.
/// </summary>
public static class FfprobeDuration
{
    public static double? TryGetSeconds(string sourcePath)
    {
        try
        {
            var psi = new ProcessStartInfo("ffprobe")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("-v");
            psi.ArgumentList.Add("error");
            psi.ArgumentList.Add("-show_entries");
            psi.ArgumentList.Add("format=duration");
            psi.ArgumentList.Add("-of");
            psi.ArgumentList.Add("default=noprint_wrappers=1:nokey=1");
            foreach (var option in MediaInputSafety.Options(sourcePath)) psi.ArgumentList.Add(option);
            psi.ArgumentList.Add(sourcePath);

            using var process = Process.Start(psi);
            if (process is null) return null;

            var stdout = process.StandardOutput.ReadToEnd();
            if (!process.WaitForExit(TimeSpan.FromSeconds(15)))
            {
                try { process.Kill(entireProcessTree: true); } catch { /* best effort */ }
                return null;
            }

            return double.TryParse(stdout.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds)
                ? seconds
                : null;
        }
        catch (Exception)
        {
            return null;
        }
    }
}
