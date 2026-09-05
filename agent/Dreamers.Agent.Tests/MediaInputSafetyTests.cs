using Dreamers.Agent.Core.Ffmpeg;
using Xunit;

namespace Dreamers.Agent.Tests;

public class MediaInputSafetyTests
{
    [Theory]
    [InlineData("source.mp4", "mov")]
    [InlineData("source.MOV", "mov")]
    [InlineData("source.mkv", "matroska")]
    [InlineData("source.webm", "matroska")]
    [InlineData("source.avi", "avi")]
    [InlineData("source.mxf", "mxf")]
    public void UploadedContainersCannotSelectNetworkProtocolsOrPlaylistDemuxers(string file, string format)
    {
        var args = MediaInputSafety.Options(file).ToList();
        Assert.Equal("file", args[args.IndexOf("-protocol_whitelist") + 1]);
        Assert.Equal(format, args[args.IndexOf("-f") + 1]);
        if (format == "mov")
        {
            Assert.Equal("0", args[args.IndexOf("-enable_drefs") + 1]);
            Assert.Equal("0", args[args.IndexOf("-use_absolute_path") + 1]);
        }
    }

    [Fact]
    public void EncodeAppliesRestrictionsBeforeOpeningInput()
    {
        var input = new FfmpegJobInput(null, @"\\nas\Projects\source.mp4", @"\\nas\Projects\out.mp4",
            "h264_nvenc", "cq", 23, null, "p4", null, "aac");
        var args = FfmpegArgs.Build(input);
        Assert.True(args.IndexOf("-protocol_whitelist") < args.IndexOf("-i"));
        Assert.True(args.IndexOf("-f") < args.IndexOf("-i"));
    }
}
