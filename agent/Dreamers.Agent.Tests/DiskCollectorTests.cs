using Dreamers.Agent.Core.Metrics;
using Xunit;

namespace Dreamers.Agent.Tests;

public class DiskCollectorTests
{
    [Fact]
    public void Collect_IncludesTheSystemDrive()
    {
        var systemDrive = Path.GetPathRoot(Environment.SystemDirectory);

        var disks = new DiskCollector().Collect();

        Assert.Contains(disks, d => string.Equals(d.Name, systemDrive, StringComparison.OrdinalIgnoreCase));
    }
}
