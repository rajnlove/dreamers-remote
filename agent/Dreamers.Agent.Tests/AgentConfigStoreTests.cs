using System.Text.Json;
using Dreamers.Agent.Core.Configuration;
using Xunit;

namespace Dreamers.Agent.Tests;

public class AgentConfigStoreTests
{
    private static string CreateTempDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), "DreamersAgentTests_" + Guid.NewGuid());
        Directory.CreateDirectory(path);
        return path;
    }

    [Fact]
    public void LoadOrCreate_OnFreshDirectory_GeneratesAgentIdAndDefaults()
    {
        var dir = CreateTempDirectory();
        try
        {
            var config = new AgentConfigStore(dir).LoadOrCreate();

            Assert.False(string.IsNullOrWhiteSpace(config.AgentId));
            Assert.True(Guid.TryParse(config.AgentId, out _));
            Assert.Equal(5, config.UpdateIntervalSeconds);
            Assert.True(File.Exists(Path.Combine(dir, "agent.json")));
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void LoadOrCreate_CalledTwice_ReturnsSameAgentId()
    {
        var dir = CreateTempDirectory();
        try
        {
            var first = new AgentConfigStore(dir).LoadOrCreate();
            var second = new AgentConfigStore(dir).LoadOrCreate();

            Assert.Equal(first.AgentId, second.AgentId);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void LoadOrCreate_PreservesManuallyEditedServerUrl()
    {
        var dir = CreateTempDirectory();
        try
        {
            var store = new AgentConfigStore(dir);
            var config = store.LoadOrCreate();
            config.ServerUrl = "https://custom.example:9999";
            store.Save(config);

            var reloaded = new AgentConfigStore(dir).LoadOrCreate();

            Assert.Equal("https://custom.example:9999", reloaded.ServerUrl);
            Assert.Equal(config.AgentId, reloaded.AgentId);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void LoadOrCreate_WithMissingAgentIdInFile_RegeneratesOnlyAgentId()
    {
        var dir = CreateTempDirectory();
        try
        {
            var configPath = Path.Combine(dir, "agent.json");
            File.WriteAllText(configPath, JsonSerializer.Serialize(new
            {
                agentId = "",
                serverUrl = "https://existing.example:8080",
                updateIntervalSeconds = 10,
            }));

            var config = new AgentConfigStore(dir).LoadOrCreate();

            Assert.False(string.IsNullOrWhiteSpace(config.AgentId));
            Assert.Equal("https://existing.example:8080", config.ServerUrl);
            Assert.Equal(10, config.UpdateIntervalSeconds);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }
}
