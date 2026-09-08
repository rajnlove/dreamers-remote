using System.Text.Json;
using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Credentials;
using Xunit;

namespace Dreamers.Agent.Tests;

/// <summary>
/// The Agent reports to more than one server: Dreamers Remote for
/// workstation management, Dreamers Encoder for the render farm. These
/// cover the two things that must not go wrong on an upgrade — an
/// already-paired machine staying paired, and exactly one server owning
/// jobs.
/// </summary>
public sealed class MultiServerConfigTests
{
    private static string NewTempDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), "dreamers-multiserver-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }

    [Fact]
    public void LoadOrCreate_MigratesLegacyServerUrl_IntoAnOwningServerEntry()
    {
        var dir = NewTempDir();
        try
        {
            File.WriteAllText(
                Path.Combine(dir, "agent.json"),
                """{"agentId":"11111111-1111-1111-1111-111111111111","serverUrl":"http://old.example:8080","updateIntervalSeconds":5}""");

            var config = new AgentConfigStore(dir).LoadOrCreate();

            var server = Assert.Single(config.Servers);
            Assert.Equal("http://old.example:8080", server.Url);
            Assert.True(server.JobOwner);
            Assert.Same(server, config.JobOwner);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void LoadOrCreate_PersistsTheMigration_SoItHappensOnce()
    {
        var dir = NewTempDir();
        try
        {
            File.WriteAllText(
                Path.Combine(dir, "agent.json"),
                """{"agentId":"11111111-1111-1111-1111-111111111111","serverUrl":"http://old.example:8080"}""");

            new AgentConfigStore(dir).LoadOrCreate();

            var raw = File.ReadAllText(Path.Combine(dir, "agent.json"));
            Assert.Contains("servers", raw, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("old.example", raw);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void LoadOrCreate_KeepsAnExplicitServerList_AndDoesNotReAddTheLegacyUrl()
    {
        var dir = NewTempDir();
        try
        {
            File.WriteAllText(
                Path.Combine(dir, "agent.json"),
                """
                {"agentId":"11111111-1111-1111-1111-111111111111",
                 "serverUrl":"http://legacy.example:8080",
                 "servers":[{"url":"http://remote.example:8080","jobOwner":false},
                            {"url":"http://encoder.example:8081","jobOwner":true}]}
                """);

            var config = new AgentConfigStore(dir).LoadOrCreate();

            Assert.Equal(2, config.Servers.Count);
            Assert.DoesNotContain(config.Servers, s => s.Url.Contains("legacy"));
            Assert.Equal("http://encoder.example:8081", config.JobOwner?.Url);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void LoadOrCreate_WithTwoOwnersInTheFile_KeepsOnlyTheFirst()
    {
        // Job ids are per-server autoincrement, so two owners means two
        // different jobs can arrive with the same id and the Agent will
        // cancel or report results against the wrong one. The file is
        // hand-editable, so this has to be enforced on load.
        var dir = NewTempDir();
        try
        {
            File.WriteAllText(
                Path.Combine(dir, "agent.json"),
                """
                {"agentId":"11111111-1111-1111-1111-111111111111",
                 "servers":[{"url":"http://a.example:8080","jobOwner":true},
                            {"url":"http://b.example:8081","jobOwner":true}]}
                """);

            var config = new AgentConfigStore(dir).LoadOrCreate();

            Assert.Single(config.Servers, s => s.JobOwner);
            Assert.Equal("http://a.example:8080", config.JobOwner?.Url);

            // And the correction is written back, not re-derived each boot.
            var reloaded = new AgentConfigStore(dir).LoadOrCreate();
            Assert.Single(reloaded.Servers, s => s.JobOwner);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void LoadOrCreate_WithNoOwner_IsAllowed_AndRunsNoJobs()
    {
        // A machine kept for remote access only is a legitimate setup.
        var dir = NewTempDir();
        try
        {
            File.WriteAllText(
                Path.Combine(dir, "agent.json"),
                """
                {"agentId":"11111111-1111-1111-1111-111111111111",
                 "servers":[{"url":"http://a.example:8080","jobOwner":false}]}
                """);

            var config = new AgentConfigStore(dir).LoadOrCreate();

            Assert.Single(config.Servers);
            Assert.Null(config.JobOwner);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void LoadOrCreate_DropsBlankServerUrls()
    {
        var dir = NewTempDir();
        try
        {
            File.WriteAllText(
                Path.Combine(dir, "agent.json"),
                """
                {"agentId":"11111111-1111-1111-1111-111111111111",
                 "servers":[{"url":"  ","jobOwner":true},{"url":"http://real.example:8080","jobOwner":false}]}
                """);

            var config = new AgentConfigStore(dir).LoadOrCreate();

            Assert.Single(config.Servers);
            Assert.Equal("http://real.example:8080", config.Servers[0].Url);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Theory]
    [InlineData("http://host:8080", "http://host:8080/")]
    [InlineData("http://host:8080", "HTTP://HOST:8080")]
    [InlineData("http://host:8080", "  http://host:8080  ")]
    public void CredentialFileName_IgnoresTrailingSlashCaseAndWhitespace(string a, string b)
    {
        // A trailing slash typed into agent.json would otherwise look
        // like a different, unregistered server, and the machine would
        // silently drop out of the farm.
        Assert.Equal(AgentCredentialStore.FileNameFor(a), AgentCredentialStore.FileNameFor(b));
    }

    [Fact]
    public void CredentialFileName_DiffersPerServer()
    {
        Assert.NotEqual(
            AgentCredentialStore.FileNameFor("http://remote.example:8080"),
            AgentCredentialStore.FileNameFor("http://encoder.example:8081"));
    }

    [Fact]
    public void MigrateLegacy_MovesAnExistingPairingOntoThePerServerFile()
    {
        var dir = NewTempDir();
        try
        {
            const string url = "http://192.29.11.92:8080";
            new AgentCredentialStore(dir).Save("existing-credential");

            Assert.True(AgentCredentialStore.MigrateLegacy(dir, url));

            var perServer = new AgentCredentialStore(dir, url);
            Assert.True(perServer.HasCredential);
            Assert.Equal("existing-credential", perServer.Load());
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void MigrateLegacy_LeavesTheOldFileInPlace_SoARollbackStillWorks()
    {
        var dir = NewTempDir();
        try
        {
            const string url = "http://192.29.11.92:8080";
            new AgentCredentialStore(dir).Save("existing-credential");

            AgentCredentialStore.MigrateLegacy(dir, url);

            Assert.True(new AgentCredentialStore(dir).HasCredential);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void MigrateLegacy_IsSafeToCallRepeatedly_AndNeverOverwrites()
    {
        var dir = NewTempDir();
        try
        {
            const string url = "http://192.29.11.92:8080";
            new AgentCredentialStore(dir).Save("old-credential");
            AgentCredentialStore.MigrateLegacy(dir, url);

            // Re-registered since: the per-server credential is newer and
            // must win over the stale legacy file on every later boot.
            new AgentCredentialStore(dir, url).Save("new-credential");
            Assert.False(AgentCredentialStore.MigrateLegacy(dir, url));
            Assert.Equal("new-credential", new AgentCredentialStore(dir, url).Load());
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void MigrateLegacy_DoesNothing_WhenThereIsNoLegacyFile()
    {
        var dir = NewTempDir();
        try
        {
            Assert.False(AgentCredentialStore.MigrateLegacy(dir, "http://192.29.11.92:8080"));
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void TwoServers_HoldIndependentCredentials()
    {
        var dir = NewTempDir();
        try
        {
            const string remote = "http://192.29.11.92:8080";
            const string encoder = "http://192.29.11.92:8081";

            new AgentCredentialStore(dir, remote).Save("remote-credential");
            new AgentCredentialStore(dir, encoder).Save("encoder-credential");

            Assert.Equal("remote-credential", new AgentCredentialStore(dir, remote).Load());
            Assert.Equal("encoder-credential", new AgentCredentialStore(dir, encoder).Load());
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }
}
