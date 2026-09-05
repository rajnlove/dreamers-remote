namespace Dreamers.Agent.Core.Ffmpeg;

/// <summary>Restrict self-contained uploaded media to file I/O and its expected demuxer.</summary>
public static class MediaInputSafety
{
    public static IEnumerable<string> Options(string sourcePath)
    {
        var format = Path.GetExtension(sourcePath).ToLowerInvariant() switch
        {
            ".mp4" or ".mov" => "mov",
            ".mkv" or ".webm" => "matroska",
            ".avi" => "avi",
            ".mxf" => "mxf",
            _ => null,
        };
        // Other internal job formats retain their existing behavior.
        if (format is null) yield break;
        yield return "-protocol_whitelist"; yield return "file";
        yield return "-f"; yield return format;
        if (format == "mov")
        {
            yield return "-enable_drefs"; yield return "0";
            yield return "-use_absolute_path"; yield return "0";
        }
    }
}
