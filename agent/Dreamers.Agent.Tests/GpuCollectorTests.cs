using Dreamers.Agent.Core.Metrics;
using Xunit;

namespace Dreamers.Agent.Tests;

public class GpuCollectorTests
{
    [Fact]
    public void Collect_NeverThrows_RegardlessOfWhetherNvidiaHardwareIsPresent()
    {
        var collector = new GpuCollector();

        var exception = Record.Exception(() => collector.Collect());

        Assert.Null(exception);
    }

    [Fact]
    public void Collect_ReturnsEmptyListNotNull_WhenCalledRepeatedly()
    {
        // Also exercises the "already initialized" path a second call
        // takes, since EnsureInitialized only runs nvmlInit_v2 once.
        var collector = new GpuCollector();

        var first = collector.Collect();
        var second = collector.Collect();

        Assert.NotNull(first);
        Assert.NotNull(second);
    }

    [Fact]
    public void Collect_WhenGpusArePresent_EachHasNameAndSaneVram()
    {
        var collector = new GpuCollector();

        var gpus = collector.Collect();

        // Environment-dependent: this only asserts something when NVIDIA
        // GPUs are actually present (as they are on the CGI-Render
        // machine this was verified on — 2x RTX 3090). On a machine with
        // no NVIDIA GPU, `gpus` is empty and this loop simply doesn't run,
        // which is itself the behavior P2-3 requires (no crash, no GPUs).
        foreach (var gpu in gpus)
        {
            Assert.False(string.IsNullOrWhiteSpace(gpu.Name));
            Assert.True(gpu.VramTotalMb > 0);
            Assert.True(gpu.VramUsedMb <= gpu.VramTotalMb);
            Assert.InRange(gpu.UtilizationPercent, 0, 100);
        }
    }
}
