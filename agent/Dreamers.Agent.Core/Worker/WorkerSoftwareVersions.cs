using Dreamers.Agent.Core.Ffmpeg;

namespace Dreamers.Agent.Core.Worker;

/// <summary>
/// Installed software versions, reported on every heartbeat. "test" is a
/// fixed placeholder proving the mechanism (P3-8) end-to-end. "ffmpeg"
/// (P4-1) is real, only present when FfmpegDetector finds a working
/// install -- version string as ffmpeg itself reports it (format varies
/// by build, e.g. "6.1.1" or "n6.1.1-3-g...").
/// </summary>
public static class WorkerSoftwareVersions
{
    public static IReadOnlyDictionary<string, string> Current
    {
        get
        {
            var versions = new Dictionary<string, string> { ["test"] = "1.0.0" };
            var ffmpeg = FfmpegDetector.Current;
            if (ffmpeg.Available && ffmpeg.Version is not null)
            {
                versions["ffmpeg"] = ffmpeg.Version;
            }
            return versions;
        }
    }
}
