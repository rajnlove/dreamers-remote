using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Metrics;
using Xunit;

namespace Dreamers.Agent.Tests;

/// <summary>
/// The NAS low-space alert depends entirely on this collector: the server
/// runs in a container with no NAS mount and cannot measure the share at
/// all. What matters most here is what happens when a root is missing or
/// unreachable — reporting a wrong number would make the alert lie in the
/// direction of "plenty of room", which is the worse lie.
/// </summary>
public sealed class NasSpaceCollectorTests
{
    private static (NasSpaceCollector Collector, string Dir) Create(params string[] roots)
    {
        var dir = Path.Combine(Path.GetTempPath(), "dreamers-nasspace-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var store = new AllowedPathsConfigStore(dir);
        var config = store.LoadOrCreate();
        config.AllowedRoots.Clear();
        config.AllowedRoots.AddRange(roots);
        store.Save(config);
        return (new NasSpaceCollector(store), dir);
    }

    [Fact]
    public void Collect_WithNoConfiguredRoots_ReturnsEmpty()
    {
        var (collector, dir) = Create();
        try
        {
            Assert.Empty(collector.Collect());
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void Collect_ReportsRealNumbersForAReachablePath()
    {
        // A local temp directory stands in for the share: the same API
        // answers for both, and this keeps the test independent of whether
        // the NAS happens to be reachable from wherever it runs.
        var (collector, dir) = Create(Path.GetTempPath());
        try
        {
            var result = Assert.Single(collector.Collect());

            Assert.True(result.TotalMb > 0, "total size should be a real number");
            Assert.True(result.FreeMb >= 0);
            Assert.True(result.FreeMb <= result.TotalMb);
            Assert.InRange(result.FreePercent, 0, 100);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void Collect_SkipsAnUnreachableRoot_RatherThanReportingZeroFree()
    {
        // Zero free space would fire the low-space alert on a share that
        // is merely unreachable, and the message would point at the wrong
        // problem. NasHealthChecker already reports reachability.
        var (collector, dir) = Create(@"\\no-such-host.invalid\share");
        try
        {
            Assert.Empty(collector.Collect());
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void Collect_KeepsGoingWhenOneRootIsBad()
    {
        var (collector, dir) = Create(@"\\no-such-host.invalid\share", Path.GetTempPath());
        try
        {
            var result = Assert.Single(collector.Collect());
            Assert.Equal(Path.GetTempPath(), result.Root);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void Collect_QueriesEachDistinctRootOnce()
    {
        // Several allow-listed roots usually sit on the same share, and
        // each query is a network round trip on every heartbeat.
        var temp = Path.GetTempPath();
        var (collector, dir) = Create(temp, temp.TrimEnd('\\'), temp);
        try
        {
            Assert.Single(collector.Collect());
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void Collect_IgnoresBlankRoots()
    {
        var (collector, dir) = Create("   ", Path.GetTempPath());
        try
        {
            Assert.Single(collector.Collect());
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }
}
