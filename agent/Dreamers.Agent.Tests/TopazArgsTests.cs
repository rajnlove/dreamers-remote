using Dreamers.Agent.Core.Topaz;
using Xunit;

namespace Dreamers.Agent.Tests;

public class TopazArgsTests
{
    private static TopazJobInput Input(
        string model = "iris-2",
        int scale = 2,
        string codec = "h264_nvenc",
        string qualityMode = "cq",
        int? quality = 19,
        string? bitrate = null,
        string preset = "p6",
        string audioCodec = "aac") =>
        new(
            ProjectId: null,
            SourcePath: "\\\\nas\\Projects\\in.mov",
            OutputPath: "\\\\nas\\Projects\\out.mp4",
            Model: model,
            Scale: scale,
            Codec: codec,
            QualityMode: qualityMode,
            Quality: quality,
            Bitrate: bitrate,
            Preset: preset,
            AudioCodec: audioCodec);

    [Fact]
    public void BuildsExpectedArgsForACqJob()
    {
        var args = TopazArgs.Build(Input());

        Assert.Contains("-i", args);
        Assert.Equal("\\\\nas\\Projects\\in.mov", args[args.IndexOf("-i") + 1]);
        Assert.Contains("-vf", args);
        Assert.Equal("tvai_up=model=iris-2:scale=2:device=-2", args[args.IndexOf("-vf") + 1]);
        Assert.Contains("h264_nvenc", args);
        Assert.Contains("-cq", args);
        Assert.Equal("19", args[args.IndexOf("-cq") + 1]);
        Assert.Equal("\\\\nas\\Projects\\out.mp4", args[^1]);
    }

    [Fact]
    public void UsesBitrateForVbrMode()
    {
        var args = TopazArgs.Build(Input(qualityMode: "vbr", quality: null, bitrate: "10M"));

        Assert.Contains("-b:v", args);
        Assert.Equal("10M", args[args.IndexOf("-b:v") + 1]);
        Assert.DoesNotContain("-cq", args);
    }

    [Fact]
    public void ForcesYuv420pFor264NvencOnly()
    {
        var h264Args = TopazArgs.Build(Input(codec: "h264_nvenc"));
        Assert.Contains("-pix_fmt", h264Args);
        Assert.Equal("yuv420p", h264Args[h264Args.IndexOf("-pix_fmt") + 1]);

        var hevcArgs = TopazArgs.Build(Input(codec: "hevc_nvenc"));
        Assert.DoesNotContain("-pix_fmt", hevcArgs);
    }

    [Fact]
    public void AddsAnFlagWhenAudioCodecIsNone()
    {
        var args = TopazArgs.Build(Input(audioCodec: "none"));
        Assert.Contains("-an", args);
        Assert.DoesNotContain("-c:a", args);
    }

    [Fact]
    public void AlwaysIncludesMachineReadableProgressFlags()
    {
        var args = TopazArgs.Build(Input());
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
        Assert.Throws<ArgumentException>(() => TopazArgs.Build(Input(codec: codec)));
    }

    [Theory]
    [InlineData("Iris-2")] // uppercase not allowed
    [InlineData("iris:2")] // filter-graph option separator
    [InlineData("iris,2")] // filter-graph chain separator
    [InlineData("iris;other_filter")] // filter-graph segment separator
    [InlineData("")]
    public void RejectsAModelNameThatIsNotInTheSafeWhitelist(string model)
    {
        Assert.Throws<ArgumentException>(() => TopazArgs.Build(Input(model: model)));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(5)]
    public void RejectsAnOutOfRangeScale(int scale)
    {
        Assert.Throws<ArgumentException>(() => TopazArgs.Build(Input(scale: scale)));
    }

    [Fact]
    public void PassesSourcePathThroughAsOneUnsplitArgument()
    {
        var unusualPath = "\\\\nas\\Projects\\in.mov\" & calc.exe & \"";
        var withUnusualSource = new TopazJobInput(
            null, unusualPath, "\\\\nas\\Projects\\out.mp4", "iris-2", 2, "h264_nvenc", "cq", 19, null, "p6", "aac");

        var args = TopazArgs.Build(withUnusualSource);

        Assert.Equal(unusualPath, args[args.IndexOf("-i") + 1]);
        Assert.DoesNotContain(args, a => a == "calc.exe");
    }
}
