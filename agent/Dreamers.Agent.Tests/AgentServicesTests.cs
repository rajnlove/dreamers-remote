using Dreamers.Agent;
using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Credentials;
using Dreamers.Agent.Core.Server;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Dreamers.Agent.Tests;

/// <summary>
/// Guards the failure mode that compiles: a constructor changes, its
/// registration does not, the build stays green, and the service dies on
/// startup — on four workstations at once, after the installer has
/// already replaced the binary.
/// </summary>
public sealed class AgentServicesTests
{
    private static string NewTempDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), "dreamers-di-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }

    private static ServiceProvider BuildProvider(string dir, AgentConfig config)
    {
        var services = new ServiceCollection();
        services.AddLogging(b => b.SetMinimumLevel(LogLevel.None));
        AgentServices.Register(
            services,
            config,
            new AgentConfigStore(dir),
            dir,
            new MonitoredProcessesConfig(),
            new AllowedPathsConfigStore(dir),
            new NasCredentialStore(dir),
            new TopazConfigStore(dir));
        return services.BuildServiceProvider(validateScopes: true);
    }

    private static AgentConfig ConfigWith(params (string Url, bool Owner)[] servers)
    {
        var config = new AgentConfig { AgentId = Guid.NewGuid().ToString() };
        config.Servers.Clear();
        foreach (var (url, owner) in servers)
        {
            config.Servers.Add(new AgentServerConfig { Url = url, JobOwner = owner });
        }

        return config;
    }

    [Fact]
    public void TheHostedServiceCanBeConstructed_ForASingleServer()
    {
        var dir = NewTempDir();
        try
        {
            using var provider = BuildProvider(dir, ConfigWith(("http://a.example:8080", true)));

            var hosted = Assert.Single(provider.GetServices<IHostedService>());
            Assert.IsType<Worker>(hosted);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void TheHostedServiceCanBeConstructed_ForTwoServers()
    {
        var dir = NewTempDir();
        try
        {
            using var provider = BuildProvider(
                dir,
                ConfigWith(("http://remote.example:8080", false), ("http://encoder.example:8081", true)));

            Assert.IsType<Worker>(Assert.Single(provider.GetServices<IHostedService>()));
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void EachServerGetsItsOwnClientAndCredentialStore()
    {
        // Sending one server's credential to the other authenticates as
        // nobody, and the symptom — a machine that looks unregistered —
        // points nowhere near the actual wiring mistake.
        var dir = NewTempDir();
        try
        {
            const string remote = "http://remote.example:8080";
            const string encoder = "http://encoder.example:8081";
            new AgentCredentialStore(dir, remote).Save("remote-credential");
            new AgentCredentialStore(dir, encoder).Save("encoder-credential");

            using var provider = BuildProvider(dir, ConfigWith((remote, false), (encoder, true)));
            var connections = provider.GetRequiredService<IReadOnlyList<ServerConnection>>();

            Assert.Equal(2, connections.Count);
            Assert.Equal("remote-credential", connections.Single(c => c.Url == remote).Credential);
            Assert.Equal("encoder-credential", connections.Single(c => c.Url == encoder).Credential);
            Assert.NotSame(connections[0].Client, connections[1].Client);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void ExactlyOneConnectionOwnsJobs()
    {
        var dir = NewTempDir();
        try
        {
            using var provider = BuildProvider(
                dir,
                ConfigWith(("http://remote.example:8080", false), ("http://encoder.example:8081", true)));
            var connections = provider.GetRequiredService<IReadOnlyList<ServerConnection>>();

            var owner = Assert.Single(connections, c => c.JobOwner);
            Assert.Equal("http://encoder.example:8081", owner.Url);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void AnUnregisteredServerYieldsANullCredential_RatherThanThrowing()
    {
        // The normal intermediate state during a rollout: paired with one
        // server, not yet with the other. It must not stop the Agent from
        // starting.
        var dir = NewTempDir();
        try
        {
            using var provider = BuildProvider(dir, ConfigWith(("http://nobody.example:8080", true)));
            var connections = provider.GetRequiredService<IReadOnlyList<ServerConnection>>();

            Assert.Null(Assert.Single(connections).Credential);
            Assert.IsType<Worker>(Assert.Single(provider.GetServices<IHostedService>()));
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }
}
