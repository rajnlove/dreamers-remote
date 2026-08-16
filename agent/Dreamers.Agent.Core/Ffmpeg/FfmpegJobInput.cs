namespace Dreamers.Agent.Core.Ffmpeg;

/// <summary>
/// Mirrors server/src/job/ffmpegValidation.ts's FfmpegJobInput exactly
/// -- deserialized from the job's `input` JSON (already validated
/// server-side at POST /api/jobs time, but FfmpegJobRunner re-validates
/// independently before touching the filesystem or spawning a process;
/// see PathValidator and FfmpegArgs).
/// </summary>
public sealed record FfmpegJobInput(
    string? ProjectId,
    string SourcePath,
    string OutputPath,
    string Codec,
    string QualityMode,
    int? Quality,
    string? Bitrate,
    string Preset,
    string? Resolution,
    string AudioCodec);
