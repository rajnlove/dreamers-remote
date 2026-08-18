using System.Text.RegularExpressions;

namespace Dreamers.Agent.Core.Ffmpeg;

/// <summary>
/// P4-2: builds the ffmpeg.exe argument list from a whitelist only --
/// this is the actual security boundary the spec calls for ("PHP gửi
/// structured job options, Worker tự build FFmpeg arguments từ
/// whitelist, không cho command injection"). No caller-supplied string
/// is ever concatenated into a shell command; every value here is
/// either a fixed flag or checked against an enum/regex before being
/// placed in the returned list, which the caller passes to
/// ProcessStartInfo.ArgumentList (never UseShellExecute) so there's no
/// shell to inject into in the first place even if a check here had a
/// bug. Pure function, no I/O -- doesn't check the source file exists
/// or that paths are under an allowed root (FfmpegJobRunner does that
/// separately via PathValidator before ever calling this).
/// </summary>
public static class FfmpegArgs
{
    // internal, not private: reused by Topaz/TopazArgs.cs so a topaz
    // job's post-upscale encode step validates against the exact same
    // whitelist as an ffmpeg job's encode, instead of a copy-pasted
    // second one that could drift out of sync.
    internal static readonly HashSet<string> AllowedCodecs = new() { "h264_nvenc", "hevc_nvenc", "av1_nvenc" };
    internal static readonly HashSet<string> AllowedQualityModes = new() { "cq", "vbr" };
    internal static readonly HashSet<string> AllowedPresets = new() { "p1", "p2", "p3", "p4", "p5", "p6", "p7" };
    internal static readonly HashSet<string> AllowedAudioCodecs = new() { "aac", "copy", "none" };
    internal static readonly Regex BitratePattern = new(@"^\d+[kKmM]$", RegexOptions.Compiled);
    private static readonly Regex ResolutionPattern = new(@"^(\d{2,5})x(\d{2,5})$", RegexOptions.Compiled);

    private const int DefaultCqQuality = 23;
    private const string DefaultVbrBitrate = "8M";

    public static List<string> Build(FfmpegJobInput input)
    {
        if (!AllowedCodecs.Contains(input.Codec))
        {
            throw new ArgumentException($"Unsupported codec: \"{input.Codec}\"");
        }
        if (!AllowedQualityModes.Contains(input.QualityMode))
        {
            throw new ArgumentException($"Unsupported qualityMode: \"{input.QualityMode}\"");
        }
        if (!AllowedPresets.Contains(input.Preset))
        {
            throw new ArgumentException($"Unsupported preset: \"{input.Preset}\"");
        }
        if (!AllowedAudioCodecs.Contains(input.AudioCodec))
        {
            throw new ArgumentException($"Unsupported audioCodec: \"{input.AudioCodec}\"");
        }
        if (input.Quality is { } q && (q < 0 || q > 51))
        {
            throw new ArgumentException($"quality out of range 0-51: {q}");
        }
        if (input.Bitrate is not null && !BitratePattern.IsMatch(input.Bitrate))
        {
            throw new ArgumentException($"Malformed bitrate: \"{input.Bitrate}\"");
        }
        Match? resolutionMatch = null;
        if (input.Resolution is not null)
        {
            resolutionMatch = ResolutionPattern.Match(input.Resolution);
            if (!resolutionMatch.Success)
            {
                throw new ArgumentException($"Malformed resolution: \"{input.Resolution}\"");
            }
        }

        var args = new List<string>
        {
            "-y", // overwrite outputPath if it already exists -- the caller (FfmpegJobRunner) already validated it's under an allowed root
            "-i", input.SourcePath,
            "-c:v", input.Codec,
            "-preset", input.Preset,
        };

        if (input.QualityMode == "cq")
        {
            args.AddRange(new[] { "-rc", "vbr", "-cq", (input.Quality ?? DefaultCqQuality).ToString() });
        }
        else // "vbr"
        {
            args.AddRange(new[] { "-rc", "vbr", "-b:v", input.Bitrate ?? DefaultVbrBitrate });
        }

        if (resolutionMatch is { Success: true })
        {
            args.AddRange(new[] { "-vf", $"scale={resolutionMatch.Groups[1].Value}:{resolutionMatch.Groups[2].Value}" });
        }

        // h264_nvenc on real hardware rejects 10-bit input outright
        // ("10 bit encode not supported... No capable devices found") --
        // confirmed against a real 10-bit ProRes source. H.264 delivery
        // is essentially always 8-bit 4:2:0 anyway (Main/High profiles),
        // so force it down rather than fail every 10-bit source. hevc_nvenc
        // and av1_nvenc both genuinely support 10-bit (Main10 profile) on
        // this hardware -- forcing 8-bit there would just be an
        // unnecessary quality loss, so this is intentionally scoped to
        // h264_nvenc only, not "-pix_fmt yuv420p" for every codec.
        if (input.Codec == "h264_nvenc")
        {
            args.AddRange(new[] { "-pix_fmt", "yuv420p" });
        }

        if (input.AudioCodec == "none")
        {
            args.Add("-an");
        }
        else
        {
            args.AddRange(new[] { "-c:a", input.AudioCodec });
        }

        // Machine-readable key=value progress on stdout instead of the
        // default human-readable stats line on stderr -- FfmpegJobRunner
        // parses this, not free-text.
        args.AddRange(new[] { "-progress", "pipe:1", "-nostats" });

        args.Add(input.OutputPath);
        return args;
    }
}
