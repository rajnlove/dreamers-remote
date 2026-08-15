using Dreamers.Agent.Core.Configuration;
using Xunit;

namespace Dreamers.Agent.Tests;

public class MonitoredProcessesConfigStoreTests
{
    private static string CreateTempDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), "DreamersAgentProcessConfigTests_" + Guid.NewGuid());
        Directory.CreateDirectory(path);
        return path;
    }

    [Fact]
    public void LoadOrCreate_OnFreshDirectory_WritesDefaultListIncludingHoudiniAndAfterEffects()
    {
        var dir = CreateTempDirectory();
        try
        {
            var config = new MonitoredProcessesConfigStore(dir).LoadOrCreate();

            Assert.Contains("AfterFX.exe", config.ProcessNames);
            Assert.Contains("houdini.exe", config.ProcessNames);
            Assert.True(File.Exists(Path.Combine(dir, "monitored_processes.json")));
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void LoadOrCreate_PreservesHandEditedList()
    {
        var dir = CreateTempDirectory();
        try
        {
            var store = new MonitoredProcessesConfigStore(dir);
            store.Save(new MonitoredProcessesConfig { ProcessNames = new List<string> { "custom-app.exe" } });

            var reloaded = new MonitoredProcessesConfigStore(dir).LoadOrCreate();

            Assert.Single(reloaded.ProcessNames);
            Assert.Equal("custom-app.exe", reloaded.ProcessNames[0]);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }
}
