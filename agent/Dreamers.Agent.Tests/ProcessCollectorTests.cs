using System.Diagnostics;
using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Metrics;
using Xunit;

namespace Dreamers.Agent.Tests;

public class ProcessCollectorTests
{
    [Fact]
    public void Collect_FindsARealRunningProcess_ByExactName()
    {
        var currentProcessName = Process.GetCurrentProcess().ProcessName + ".exe";
        var config = new MonitoredProcessesConfig { ProcessNames = new List<string> { currentProcessName } };

        var results = new ProcessCollector(config).Collect();

        Assert.Single(results);
        Assert.True(results[0].Running);
        Assert.NotNull(results[0].Pid);
    }

    [Fact]
    public void Collect_ReportsNotRunning_ForAProcessThatDoesNotExist()
    {
        var config = new MonitoredProcessesConfig
        {
            ProcessNames = new List<string> { "definitely-not-a-real-process-12345.exe" },
        };

        var results = new ProcessCollector(config).Collect();

        Assert.Single(results);
        Assert.False(results[0].Running);
        Assert.Null(results[0].Pid);
    }

    [Fact]
    public void Collect_MatchesWildcardPrefix()
    {
        var currentProcessName = Process.GetCurrentProcess().ProcessName;
        var wildcardPattern = currentProcessName[..Math.Min(3, currentProcessName.Length)] + "*.exe";
        var config = new MonitoredProcessesConfig { ProcessNames = new List<string> { wildcardPattern } };

        var results = new ProcessCollector(config).Collect();

        Assert.True(results[0].Running);
    }
}
