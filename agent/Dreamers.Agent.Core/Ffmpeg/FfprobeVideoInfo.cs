using System.Diagnostics;

namespace Dreamers.Agent.Core.Ffmpeg;

/// <summary>
/// Source video pixel dimensions -- probed after a successful encode so
/// a completed ffmpeg job's result (JobSnapshot.Output, see
/// FfmpegJobRunner) can report what the source actually was. Kept as a
/// separate class from FfprobeDuration (not merged into one call)
/// deliberately: FfprobeDuration is also used by TopazJobRunner, and
/// this width/height feature is ffmpeg-job-only per the request that
/// added it -- keeping them separate means Topaz's ffprobe usage can't
/// regress from this change. Null on any failure (ffprobe not found,
/// unreadable file, no video stream, timeout) -- same "never fail the
/// job over a probe hiccup" policy as FfprobeDuration; width/height are
/// a nice-to-have on top of a job that already succeeded, not something
/// worth failing it over.
/// </summary>
public static class FfprobeVideoInfo
{
    public static (int Width, int Height)? TryGetDimensions(string sourcePath)
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
            psi.ArgumentList.Add("-select_streams");
            psi.ArgumentList.Add("v:0");
            psi.ArgumentList.Add("-show_entries");
            psi.ArgumentList.Add("stream=width,height");
            // csv with a custom separator gives one line like "1920x1080"
            // directly -- no JSON/XML parsing needed for two numbers.
            psi.ArgumentList.Add("-of");
            psi.ArgumentList.Add("csv=s=x:p=0");
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

            var parts = stdout.Trim().Split('x');
            if (parts.Length == 2
                && int.TryParse(parts[0], out var width)
                && int.TryParse(parts[1], out var height)
                && width > 0 && height > 0)
            {
                return (width, height);
            }
            return null;
        }
        catch (Exception)
        {
            return null;
        }
    }
}
