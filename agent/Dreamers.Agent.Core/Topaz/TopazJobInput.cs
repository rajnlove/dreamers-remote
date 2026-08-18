namespace Dreamers.Agent.Core.Topaz;

/// <summary>
/// Mirrors server/src/job/topazValidation.ts's TopazJobInput exactly --
/// deserialized from the job's `input` JSON (already validated
/// server-side at POST /api/jobs time, but TopazJobRunner re-validates
/// independently before touching the filesystem or spawning a process;
/// see PathValidator (reused from Ffmpeg/) and TopazArgs).
///
/// Model/Scale drive the "tvai_up" upscale filter (P4-4 v1 scope --
/// frame interpolation/stabilization deferred, see docs/ROADMAP.md).
/// Codec/QualityMode/Quality/Bitrate/Preset/AudioCodec are the SAME
/// enums/fields as an ffmpeg job's encode step -- upscaling still needs
/// a real output codec afterward, and duplicating a second whitelist
/// for that would just be copy-paste of Ffmpeg/FfmpegArgs.cs.
/// </summary>
public sealed record TopazJobInput(
    string? ProjectId,
    string SourcePath,
    string OutputPath,
    string Model,
    int Scale,
    string Codec,
    string QualityMode,
    int? Quality,
    string? Bitrate,
    string Preset,
    string AudioCodec);
