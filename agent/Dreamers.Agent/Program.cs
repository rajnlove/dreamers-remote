using System.Diagnostics;
using Dreamers.Agent;
using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Logging;
using Dreamers.Agent.Core.Metrics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Hosting.WindowsServices;
using Microsoft.Extensions.Logging;

const string ServiceName = "DreamersAgent";
const string ServiceDisplayName = "Dreamers Remote Agent";

if (args.Length > 0 && TryHandleServiceCommand(args[0]))
{
    return;
}

var dataDirectory = AgentConfigStore.DefaultDataDirectory;
var configStore = new AgentConfigStore(dataDirectory);
var config = configStore.LoadOrCreate();

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddSingleton(config);
builder.Services.AddSingleton<MetricsCollector>();
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
