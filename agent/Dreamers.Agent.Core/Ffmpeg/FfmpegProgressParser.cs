using System.Globalization;

namespace Dreamers.Agent.Core.Ffmpeg;

public sealed record FfmpegProgressUpdate(double? Fps, double? OutTimeSeconds, bool Ended);

/// <summary>
/// Parses ffmpeg's "-progress pipe:1" output: repeated blocks of
/// "key=value" lines, each block terminated by a "progress=continue" or
/// "progress=end" line. Machine-readable and stable across ffmpeg
/// versions, unlike scraping the default human-readable stderr stats
/// line -- this is why FfmpegArgs always adds "-progress pipe:1
/// -nostats". Pure/stateful-but-no-I/O, so it's unit-testable without a
/// real ffmpeg process (see FfmpegProgressParserTests.cs).
/// </summary>
public sealed class FfmpegProgressParser
{
    private readonly Dictionary<string, string> _current = new();

    /// <summary>Feed one line of stdout. Returns a completed update once a block's terminating "progress=..." line arrives, otherwise null.</summary>
    public FfmpegProgressUpdate? FeedLine(string line)
    {
        var idx = line.IndexOf('=');
        if (idx < 0) return null;

        var key = line[..idx].Trim();
        var value = line[(idx + 1)..].Trim();
        _current[key] = value;

        if (key != "progress") return null;

        var update = new FfmpegProgressUpdate(
            Fps: _current.TryGetValue("fps", out var fpsStr) && double.TryParse(fpsStr, NumberStyles.Float, CultureInfo.InvariantCulture, out var fps) ? fps : null,
            OutTimeSeconds: _current.TryGetValue("out_time_us", out var usStr) && long.TryParse(usStr, out var us) ? us / 1_000_000.0 : null,
            Ended: value == "end");
        _current.Clear();
        return update;
    }
}
