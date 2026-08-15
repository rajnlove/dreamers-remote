using System.Diagnostics;
using Dreamers.Agent;
using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Credentials;
using Dreamers.Agent.Core.Logging;
using Dreamers.Agent.Core.Metrics;
using Dreamers.Agent.Core.Server;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Hosting.WindowsServices;
using Microsoft.Extensions.Logging;

const string ServiceName = "DreamersAgent";
const string ServiceDisplayName = "Dreamers Remote Agent";

if (args.Length > 0 && string.Equals(args[0], "register", StringComparison.OrdinalIgnoreCase))
{
    await HandleRegisterAsync(args);
    return;
}

if (args.Length > 0 && TryHandleServiceCommand(args[0]))
{
    return;
}

var dataDirectory = AgentConfigStore.DefaultDataDirectory;
var configStore = new AgentConfigStore(dataDirectory);
var config = configStore.LoadOrCreate();

var processesConfigStore = new MonitoredProcessesConfigStore(dataDirectory);
var processesConfig = processesConfigStore.LoadOrCreate();

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddSingleton(config);
builder.Services.AddSingleton(processesConfig);
builder.Services.AddSingleton(new AgentCredentialStore(dataDirectory));
builder.Services.AddSingleton<MetricsCollector>();
builder.Services.AddHttpClient<ServerClient>();
builder.Services.AddHostedService<Worker>();
builder.Services.AddWindowsService(options => options.ServiceName = ServiceName);

builder.Logging.ClearProviders();
builder.Logging.AddRollingFile(options =>
{
    options.Directory = Path.Combine(dataDirectory, "logs");
    options.RetainDays = 14;
});
if (Environment.UserInteractive)
{
    builder.Logging.AddConsole();
}

var host = builder.Build();
host.Run();

// --- One-time pairing: DreamersAgent.exe register <token>. The token
// comes from an admin issuing it via POST /api/workstations/:id/agent-token
// (see docs/SECURITY.md) and is single-use/short-lived — the credential
// this returns is what gets stored (via DPAPI) and reused for every
// heartbeat afterward.
async Task HandleRegisterAsync(string[] commandArgs)
{
    if (commandArgs.Length < 2 || string.IsNullOrWhiteSpace(commandArgs[1]))
    {
        Console.Error.WriteLine("Usage: DreamersAgent.exe register <registration-token>");
        return;
    }

    var dir = AgentConfigStore.DefaultDataDirectory;
    var cfg = new AgentConfigStore(dir).LoadOrCreate();

    using var httpClient = new HttpClient();
    var client = new ServerClient(httpClient, cfg);

    try
    {
        var credential = await client.RegisterAsync(commandArgs[1]);
        new AgentCredentialStore(dir).Save(credential);
        Console.WriteLine("Registered successfully. Restart the service to start sending heartbeats:");
        Console.WriteLine("  DreamersAgent.exe stop");
        Console.WriteLine("  DreamersAgent.exe start");
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"Registration failed: {ex.Message}");
    }
}

// --- Self-install as a Windows Service, so the deliverable is just
// "copy DreamersAgent.exe, run `DreamersAgent.exe install`" — no separate
// installer/MSI needed. Wraps the built-in `sc.exe`, nothing custom.
bool TryHandleServiceCommand(string command)
{
    var exePath = Environment.ProcessPath;
    if (string.IsNullOrEmpty(exePath))
    {
        Console.Error.WriteLine("Could not determine the agent's own executable path.");
        return true;
    }

    switch (command.ToLowerInvariant())
    {
        case "install":
            RunSc($"create {ServiceName} binPath= \"{exePath}\" DisplayName= \"{ServiceDisplayName}\" start= auto");
            RunSc($"description {ServiceName} \"Collects workstation metrics and executes whitelisted management commands for Dreamers Remote.\"");
            Console.WriteLine($"Installed. Start it with: DreamersAgent.exe start (or: sc start {ServiceName}).");
            return true;
        case "uninstall":
            RunSc($"delete {ServiceName}");
            return true;
        case "start":
            RunSc($"start {ServiceName}");
            return true;
        case "stop":
            RunSc($"stop {ServiceName}");
            return true;
        default:
            return false;
    }
}

void RunSc(string arguments)
{
    var psi = new ProcessStartInfo("sc.exe", arguments)
    {
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        UseShellExecute = false,
    };

    using var process = Process.Start(psi);
    if (process is null)
    {
        Console.Error.WriteLine("Failed to start sc.exe.");
        return;
    }

    Console.Write(process.StandardOutput.ReadToEnd());
    Console.Error.Write(process.StandardError.ReadToEnd());
    process.WaitForExit();
}
