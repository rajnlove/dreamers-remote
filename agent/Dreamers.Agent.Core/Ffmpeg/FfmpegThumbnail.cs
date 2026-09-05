using System.Diagnostics;

namespace Dreamers.Agent.Core.Ffmpeg;

/// <summary>
/// Best-effort single-frame JPEG thumbnail of a completed encode, saved
/// next to the job's own output file (same allowed root it was already
/// validated under -- no new storage location to configure). Seeks 1s
/// in rather than grabbing frame 0, which is occasionally black/blank on
/// some sources (fades in, letterbox bars settling, ...); falls back to
/// frame 0 if that fails (e.g. the clip is shorter than 1s). Null (no
/// thumbnail attached to the job's result) on any failure -- same
/// "never fail the job over this" policy as FfprobeDuration/
/// FfprobeVideoInfo; a thumbnail is a nice-to-have on a job that already
/// succeeded, not something worth failing it over.
/// </summary>
public static class FfmpegThumbnail
{
    public static string? TryGenerate(string videoPath, string thumbnailPath)
    {
        if (TryRun(videoPath, thumbnailPath, seekSeconds: 1) || TryRun(videoPath, thumbnailPath, seekSeconds: 0))
        {
            return thumbnailPath;
        }
        return null;
    }

    private static bool TryRun(string videoPath, string thumbnailPath, int seekSeconds)
    {
        try
        {
            var psi = new ProcessStartInfo("ffmpeg")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("-y");
            if (seekSeconds > 0)
            {
                psi.ArgumentList.Add("-ss");
                psi.ArgumentList.Add(seekSeconds.ToString());
            }
            foreach (var option in MediaInputSafety.Options(videoPath)) psi.ArgumentList.Add(option);
            psi.ArgumentList.Add("-i");
            psi.ArgumentList.Add(videoPath);
            psi.ArgumentList.Add("-vframes");
            psi.ArgumentList.Add("1");
            // Confirmed against real ffmpeg: without -update, a single
            // still-image output to a fixed filename (not a %03d-style
            // sequence pattern) prints a warning suggesting exactly this
            // flag -- harmless (still exits 0, file still gets written),
            // but silencing it is one line.
            psi.ArgumentList.Add("-update");
            psi.ArgumentList.Add("1");
            psi.ArgumentList.Add("-q:v");
            psi.ArgumentList.Add("3");
            psi.ArgumentList.Add(thumbnailPath);

            using var process = Process.Start(psi);
            if (process is null) return false;

            if (!process.WaitForExit(TimeSpan.FromSeconds(20)))
            {
                try { process.Kill(entireProcessTree: true); } catch { /* best effort */ }
                return false;
            }

            return process.ExitCode == 0 && File.Exists(thumbnailPath);
        }
        catch (Exception)
        {
            return false;
        }
    }
}
