using Dreamers.Agent.Core.Ffmpeg;
using Xunit;

namespace Dreamers.Agent.Tests;

public class FfmpegProgressParserTests
{
    private static readonly string[] SampleBlock =
    {
        "frame=120",
        "fps=25.00",
        "stream_0_0_q=23.0",
        "bitrate=1234.5kbits/s",
        "total_size=1234567",
        "out_time_us=4800000",
        "out_time_ms=4800000",
        "out_time=00:00:04.800000",
        "dup_frames=0",
        "drop_frames=0",
        "speed=1.2x",
        "progress=continue",
    };

    [Fact]
    public void ReturnsNullUntilTheProgressLineArrives()
    {
        var parser = new FfmpegProgressParser();
        foreach (var line in SampleBlock[..^1])
        {
            Assert.Null(parser.FeedLine(line));
        }
    }

    [Fact]
    public void EmitsAnUpdateOnTheProgressLine()
    {
        var parser = new FfmpegProgressParser();
        FfmpegProgressUpdate? update = null;
        foreach (var line in SampleBlock)
        {
            update = parser.FeedLine(line) ?? update;
        }

        Assert.NotNull(update);
        Assert.Equal(25.0, update!.Fps);
        Assert.Equal(4.8, update.OutTimeSeconds);
        Assert.False(update.Ended);
    }

    [Fact]
    public void MarksEndedWhenProgressEqualsEnd()
    {
        var parser = new FfmpegProgressParser();
        var update = parser.FeedLine("progress=end");
        Assert.NotNull(update);
        Assert.True(update!.Ended);
    }

    [Fact]
    public void ResetsBetweenBlocks()
    {
        var parser = new FfmpegProgressParser();
        foreach (var line in SampleBlock) parser.FeedLine(line);

        // Second block has no "fps" line at all -- must not leak the
        // previous block's fps value into this one.
        var update = parser.FeedLine("out_time_us=9600000");
        Assert.Null(update); // no "progress=" line yet in this block
        update = parser.FeedLine("progress=continue");

        Assert.NotNull(update);
        Assert.Null(update!.Fps);
        Assert.Equal(9.6, update.OutTimeSeconds);
    }

    [Fact]
    public void IgnoresLinesWithoutAnEqualsSign()
    {
        var parser = new FfmpegProgressParser();
        Assert.Null(parser.FeedLine("not a key value line"));
    }
}
