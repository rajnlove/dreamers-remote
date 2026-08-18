using System.Text.RegularExpressions;
using Dreamers.Agent.Core.Ffmpeg;

namespace Dreamers.Agent.Core.Topaz;

/// <summary>
/// P4-4: builds Topaz's ffmpeg.exe argument list from a whitelist only,
/// mirroring Ffmpeg/FfmpegArgs.cs's security contract exactly -- no
/// caller-supplied string is ever concatenated into a shell command,
/// every value here is checked against an enum/regex first. Reuses
/// FfmpegArgs's codec/qualityMode/preset/audioCodec whitelists (see
/// FfmpegArgs.cs) for the post-upscale encode step rather than
/// duplicating them.
///
/// Model is NOT a fixed enum, unlike codec/preset -- Topaz's upscale
/// models (e.g. "iris-2", "proteus-3") are numerous and change with
/// Topaz app updates, so a hardcoded list would go stale and block
/// legitimate new models. But it's still interpolated into an ffmpeg
/// filter-graph expression ("-vf tvai_up=model=...:scale=...") as one
/// ArgumentList entry -- ArgumentList blocks OS shell injection, but an
/// unrestricted value could still inject extra filter-graph directives
/// via ':'/','/';' (ffmpeg's own filter-graph syntax). ModelPattern
/// restricts to Topaz's actual naming convention (lowercase
/// alphanumeric + dash) and nothing else.
/// </summary>
public static class TopazArgs
{
    private static readonly Regex ModelPattern = new(@"^[a-z0-9-]{1,32}$", RegexOptions.Compiled);

    private const int MinScale = 1;
    private const int MaxScale = 4;
    private const int DefaultCqQuality = 23;
    private const string DefaultVbrBitrate = "8M";

    // gpuSlot: the GPU index the scheduler reserved this job's unit on
    // (see IJobRunner.Start's doc comment) -- null leaves both the
    // upscale filter and the encode step on their own defaults (Auto).
    // When present, pins BOTH the "tvai_up" model AND the NVENC encoder
    // to the same device -- pinning only one would let the driver put
    // the upscale and the encode on different physical GPUs, defeating
    // the point of an explicit slot reservation.
    public static List<string> Build(TopazJobInput input, int? gpuSlot = null)
    {
        if (!ModelPattern.IsMatch(input.Model))
        {
            throw new ArgumentException($"Invalid model name: \"{input.Model}\"");
        }
        if (input.Scale < MinScale || input.Scale > MaxScale)
        {
            throw new ArgumentException($"scale out of range {MinScale}-{MaxScale}: {input.Scale}");
        }
        if (!FfmpegArgs.AllowedCodecs.Contains(input.Codec))
        {
            throw new ArgumentException($"Unsupported codec: \"{input.Codec}\"");
        }
        if (!FfmpegArgs.AllowedQualityModes.Contains(input.QualityMode))
        {
            throw new ArgumentException($"Unsupported qualityMode: \"{input.QualityMode}\"");
        }
        if (!FfmpegArgs.AllowedPresets.Contains(input.Preset))
        {
            throw new ArgumentException($"Unsupported preset: \"{input.Preset}\"");
        }
        if (!FfmpegArgs.AllowedAudioCodecs.Contains(input.AudioCodec))
        {
            throw new ArgumentException($"Unsupported audioCodec: \"{input.AudioCodec}\"");
        }
        if (input.Quality is { } q && (q < 0 || q > 51))
        {
            throw new ArgumentException($"quality out of range 0-51: {q}");
        }
        if (input.Bitrate is not null && !FfmpegArgs.BitratePattern.IsMatch(input.Bitrate))
        {
            throw new ArgumentException($"Malformed bitrate: \"{input.Bitrate}\"");
        }

        var device = gpuSlot?.ToString() ?? "-2"; // -2 = Auto, Topaz's own default

        var args = new List<string>
        {
            "-y",
            "-i", input.SourcePath,
            "-vf", $"tvai_up=model={input.Model}:scale={input.Scale}:device={device}",
            "-c:v", input.Codec,
            "-preset", input.Preset,
        };

        if (gpuSlot is { } gpu)
        {
            args.AddRange(new[] { "-gpu", gpu.ToString() });
        }

        if (input.QualityMode == "cq")
        {
            args.AddRange(new[] { "-rc", "vbr", "-cq", (input.Quality ?? DefaultCqQuality).ToString() });
        }
        else // "vbr"
        {
            args.AddRange(new[] { "-rc", "vbr", "-b:v", input.Bitrate ?? DefaultVbrBitrate });
        }

        // Same h264_nvenc-rejects-10-bit rule as FfmpegArgs -- tvai_up's
        // output pixel format can be higher bit depth than the source,
        // and H.264 delivery is essentially always 8-bit 4:2:0 anyway.
        // See FfmpegArgs.Build's comment for the hardware-confirmed
        // reasoning; scoped to h264_nvenc only for the same reason.
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

        args.AddRange(new[] { "-progress", "pipe:1", "-nostats" });
        args.Add(input.OutputPath);
        return args;
    }
}
