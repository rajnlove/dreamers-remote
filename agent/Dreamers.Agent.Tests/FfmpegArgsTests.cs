using Dreamers.Agent.Core.Ffmpeg;
using Xunit;

namespace Dreamers.Agent.Tests;

public class FfmpegArgsTests
{
    private static FfmpegJobInput Input(
        string codec = "h264_nvenc",
        string qualityMode = "cq",
        int? quality = 19,
        string? bitrate = null,
        string preset = "p6",
        string? resolution = null,
        string audioCodec = "aac") =>
        new(
            ProjectId: null,
            SourcePath: "\\\\nas\\Projects\\in.mov",
            OutputPath: "\\\\nas\\Projects\\out.mp4",
            Codec: codec,
            QualityMode: qualityMode,
            Quality: quality,
            Bitrate: bitrate,
            Preset: preset,
            Resolution: resolution,
            AudioCodec: audioCodec);

    [Fact]
    public void BuildsExpectedArgsForACqJob()
    {
        var args = FfmpegArgs.Build(Input());

        Assert.Contains("-i", args);
        Assert.Equal("\\\\nas\\Projects\\in.mov", args[args.IndexOf("-i") + 1]);
        Assert.Contains("h264_nvenc", args);
        Assert.Contains("-cq", args);
        Assert.Equal("19", args[args.IndexOf("-cq") + 1]);
        Assert.Equal("\\\\nas\\Projects\\out.mp4", args[^1]);
    }

    [Fact]
    public void UsesBitrateForVbrMode()
    {
        var args = FfmpegArgs.Build(Input(qualityMode: "vbr", quality: null, bitrate: "10M"));

        Assert.Contains("-b:v", args);
        Assert.Equal("10M", args[args.IndexOf("-b:v") + 1]);
        Assert.DoesNotContain("-cq", args);
    }

    [Fact]
    public void DefaultsCqQualityWhenNotProvided()
    {
        var args = FfmpegArgs.Build(Input(quality: null));
        Assert.Contains("-cq", args);
    }

    [Fact]
    public void AddsAScaleToFitFilterForAValidResolution()
    {
        // Scale-to-fit (min(W,iw)/min(H,ih) + force_original_aspect_ratio=
        // decrease), not a plain "scale=W:H" that would stretch/distort
        // any source whose AR doesn't match exactly, and not something
        // that would upscale a smaller source up to fill the box.
        var args = FfmpegArgs.Build(Input(resolution: "1920x1080"));
        Assert.Contains("-vf", args);
        Assert.Equal(
            "scale=min(1920\\,iw):min(1080\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2",
            args[args.IndexOf("-vf") + 1]);
    }

    [Fact]
    public void OmitsScaleFilterWhenResolutionIsNotProvided()
    {
        // Empty/absent resolution = native size, unchanged from before --
        // no -vf at all, not "-vf scale=<source size>".
        var args = FfmpegArgs.Build(Input(resolution: null));
        Assert.DoesNotContain("-vf", args);
    }

    [Fact]
    public void AddsFaststartMovflagForAnMp4Output()
    {
        var args = FfmpegArgs.Build(Input());
        Assert.Contains("-movflags", args);
        Assert.Equal("+faststart", args[args.IndexOf("-movflags") + 1]);
    }

    [Fact]
    public void OmitsFaststartMovflagForANonMp4MovOutput()
    {
        var input = Input() with { OutputPath = "\\\\nas\\Projects\\out.mkv" };
        var args = FfmpegArgs.Build(input);
        Assert.DoesNotContain("-movflags", args);
    }

    [Fact]
    public void AddsAnFlagWhenAudioCodecIsNone()
    {
        var args = FfmpegArgs.Build(Input(audioCodec: "none"));
        Assert.Contains("-an", args);
        Assert.DoesNotContain("-c:a", args);
    }

    [Fact]
    public void ForcesYuv420pFor264NvencOnly()
    {
        var h264Args = FfmpegArgs.Build(Input(codec: "h264_nvenc"));
        Assert.Contains("-pix_fmt", h264Args);
        Assert.Equal("yuv420p", h264Args[h264Args.IndexOf("-pix_fmt") + 1]);

        var hevcArgs = FfmpegArgs.Build(Input(codec: "hevc_nvenc"));
        Assert.DoesNotContain("-pix_fmt", hevcArgs);

        var av1Args = FfmpegArgs.Build(Input(codec: "av1_nvenc"));
        Assert.DoesNotContain("-pix_fmt", av1Args);
    }

    [Fact]
    public void OmitsGpuFlagWhenNoSlotAssigned()
    {
        var args = FfmpegArgs.Build(Input(), gpuSlot: null);
        Assert.DoesNotContain("-gpu", args);
    }

    [Fact]
    public void PinsDeviceWhenAGpuSlotIsAssigned()
    {
        var args = FfmpegArgs.Build(Input(), gpuSlot: 1);
        Assert.Contains("-gpu", args);
        Assert.Equal("1", args[args.IndexOf("-gpu") + 1]);
    }

    [Fact]
    public void AlwaysIncludesMachineReadableProgressFlags()
    {
        var args = FfmpegArgs.Build(Input());
        Assert.Contains("-progress", args);
        Assert.Equal("pipe:1", args[args.IndexOf("-progress") + 1]);
        Assert.Contains("-nostats", args);
    }

    [Theory]
    [InlineData("mpeg2")]
    [InlineData("libx264")]
    [InlineData("")]
    public void RejectsAnUnwhitelistedCodec(string codec)
    {
        Assert.Throws<ArgumentException>(() => FfmpegArgs.Build(Input(codec: codec)));
    }

    [Fact]
    public void RejectsAnUnwhitelistedQualityMode()
    {
        Assert.Throws<ArgumentException>(() => FfmpegArgs.Build(Input(qualityMode: "custom")));
    }

    [Fact]
    public void RejectsAnUnwhitelistedPreset()
    {
        Assert.Throws<ArgumentException>(() => FfmpegArgs.Build(Input(preset: "ultrafast")));
    }

    [Fact]
    public void RejectsAnUnwhitelistedAudioCodec()
    {
        Assert.Throws<ArgumentException>(() => FfmpegArgs.Build(Input(audioCodec: "mp3")));
    }

    [Fact]
    public void RejectsAnOutOfRangeQuality()
    {
        Assert.Throws<ArgumentException>(() => FfmpegArgs.Build(Input(quality: 52)));
        Assert.Throws<ArgumentException>(() => FfmpegArgs.Build(Input(quality: -1)));
    }

    [Fact]
    public void RejectsAMalformedBitrate()
    {
        Assert.Throws<ArgumentException>(() => FfmpegArgs.Build(Input(qualityMode: "vbr", bitrate: "eight megabits")));
    }

    [Fact]
    public void RejectsAMalformedResolution()
    {
        Assert.Throws<ArgumentException>(() => FfmpegArgs.Build(Input(resolution: "1920p")));
    }

    [Fact]
    public void PassesSourcePathThroughAsOneUnsplitArgument()
    {
        // Defense-in-depth sanity check: sourcePath/outputPath aren't
        // whitelisted by this class (PathValidator does that separately)
        // -- confirm this class at least never concatenates them into a
        // joined string a shell could reinterpret, so an unusual path
        // ends up as exactly one ArgumentList element either way.
        var unusualPath = "\\\\nas\\Projects\\in.mov\" & calc.exe & \"";
        var withUnusualSource = new FfmpegJobInput(
            null, unusualPath, "\\\\nas\\Projects\\out.mp4", "h264_nvenc", "cq", 19, null, "p6", null, "aac");

        var args = FfmpegArgs.Build(withUnusualSource);

        Assert.Equal(unusualPath, args[args.IndexOf("-i") + 1]);
        Assert.DoesNotContain(args, a => a == "calc.exe");
    }
}
