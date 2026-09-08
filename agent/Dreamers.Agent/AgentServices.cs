using Dreamers.Agent.Core.Commands;
using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Credentials;
using Dreamers.Agent.Core.Jobs;
using Dreamers.Agent.Core.Metrics;
using Dreamers.Agent.Core.Server;
using Microsoft.Extensions.DependencyInjection;

namespace Dreamers.Agent;

/// <summary>
/// The Agent's service registrations, extracted from Program.cs so a test
/// can build the same object graph.
///
/// This exists because of a failure mode that compiles cleanly: change a
/// constructor, forget the registration, and the build stays green while
/// the service dies on startup — on four workstations at once, after the
/// installer has already replaced the binary. A test that resolves the
/// hosted service through this method catches it on the way in.
/// </summary>
public static class AgentServices
{
    public static void Register(
        IServiceCollection services,
        AgentConfig config,
        string dataDirectory,
        MonitoredProcessesConfig processesConfig,
        AllowedPathsConfigStore allowedPathsStore,
        NasCredentialStore nasCredentialStore,
        TopazConfigStore topazConfigStore)
    {
        services.AddSingleton(config);
        services.AddSingleton(processesConfig);
        // Legacy single-file store, still used by the "register" command
        // path in Program.cs. Per-server stores are built below.
        services.AddSingleton(new AgentCredentialStore(dataDirectory));
        services.AddSingleton(allowedPathsStore);
        services.AddSingleton(nasCredentialStore);
        services.AddSingleton(topazConfigStore);
        services.AddSingleton<MetricsCollector>();
        services.AddSingleton<CommandExecutor>();
        services.AddSingleton<TestJobRunner>();
        services.AddSingleton<FfmpegJobRunner>();
        services.AddSingleton<TopazJobRunner>();

        // One HttpClient and one credential per configured server. Not a
        // typed client (AddHttpClient<ServerClient>) any more: that gives
        // the container exactly one instance, and each server needs its
        // own base address and its own credential.
        services.AddHttpClient();
        services.AddSingleton<IReadOnlyList<ServerConnection>>(sp =>
        {
            var httpClientFactory = sp.GetRequiredService<IHttpClientFactory>();
            return config.Servers
                .Select(server => new ServerConnection(
                    server,
                    new ServerClient(httpClientFactory.CreateClient(), config, server.Url),
                    new AgentCredentialStore(dataDirectory, server.Url)))
                .ToList();
        });

        services.AddHostedService<Worker>();
    }
}
