using Dreamers.Agent.Core.Ffmpeg;

namespace Dreamers.Agent.Core.Worker;

/// <summary>
/// What job types this Agent can execute, reported on every heartbeat.
/// "test" (P3-2) is always present to prove the job engine loop itself.
/// "ffmpeg" (P4-1) is added only when FfmpegDetector actually finds a
/// working ffmpeg.exe on this machine — real detection, not another
/// hardcoded placeholder, since Phase 4 is the first phase with a real
/// job type to detect.
/// </summary>
public static class WorkerCapabilities
{
    public static IReadOnlyList<string> Current
    {
        get
        {
            var capabilities = new List<string> { "test" };
            if (FfmpegDetector.Current.Available)
            {
                capabilities.Add("ffmpeg");
            }
            return capabilities;
        }
    }
}
