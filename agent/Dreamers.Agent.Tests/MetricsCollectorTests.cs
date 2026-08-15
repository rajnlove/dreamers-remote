using Dreamers.Agent.Core.Metrics;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Dreamers.Agent.Tests;

// These run against the real OS/WMI (there's no fake to swap in without
// over-engineering P2-2's scope) — appropriate here since the only
// environment these ever run in is a real Windows machine, same as the
// agent itself.
public class MetricsCollectorTests
{
    [Fact]
    public void Collect_ReturnsRealHostnameAndArchitecture()
    {
        var collector = new MetricsCollector(NullLogger<MetricsCollector>.Instance);

        var snapshot = collector.Collect();

        Assert.Equal(Environment.MachineName, snapshot.Hostname);
        Assert.False(string.IsNullOrWhiteSpace(snapshot.Architecture));
        Assert.False(string.IsNullOrWhiteSpace(snapshot.AgentVersion));
    }

    [Fact]
    public void Collect_ReturnsPositiveUptime()
    {
        var collector = new MetricsCollector(NullLogger<MetricsCollector>.Instance);

        var snapshot = collector.Collect();

        Assert.NotNull(snapshot.Uptime);
        Assert.True(snapshot.Uptime > TimeSpan.Zero);
    }

    [Fact]
    public void Collect_ReturnsMemoryWithinSaneBounds()
    {
        var collector = new MetricsCollector(NullLogger<MetricsCollector>.Instance);

        var snapshot = collector.Collect();

        Assert.NotNull(snapshot.Memory);
        Assert.True(snapshot.Memory!.TotalMb > 0);
        Assert.InRange(snapshot.Memory.UsagePercent, 0, 100);
        Assert.True(snapshot.Memory.UsedMb <= snapshot.Memory.TotalMb);
    }

    [Fact]
    public void Collect_ReturnsCpuWithMatchingLogicalProcessorCount()
    {
        var collector = new MetricsCollector(NullLogger<MetricsCollector>.Instance);

        var snapshot = collector.Collect();

        Assert.NotNull(snapshot.Cpu);
        Assert.Equal(Environment.ProcessorCount, snapshot.Cpu!.LogicalProcessorCount);
        Assert.False(string.IsNullOrWhiteSpace(snapshot.Cpu.Name));
    }

    [Fact]
    public void CpuCollector_FirstSampleHasNoUtilization_SecondSampleDoes()
    {
        var cpuCollector = new CpuCollector();

        var first = cpuCollector.Collect();
        Assert.Null(first.UtilizationPercent);

        Thread.Sleep(200);
        var second = cpuCollector.Collect();

        Assert.NotNull(second.UtilizationPercent);
        Assert.InRange(second.UtilizationPercent!.Value, 0, 100);
    }
}
