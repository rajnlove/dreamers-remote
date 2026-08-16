using System.Diagnostics;
using Dreamers.Agent;
using Dreamers.Agent.Core.Commands;
using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Credentials;
using Dreamers.Agent.Core.Jobs;
using Dreamers.Agent.Core.Logging;
using Dreamers.Agent.Core.Metrics;
using Dreamers.Agent.Core.Server;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Hosting.WindowsServices;
using Microsoft.Extensions.Logging;
using Microsoft.Win32;
using System.Security.Principal;

const string ServiceName = "DreamersAgent";
const string ServiceDisplayName = "Dreamers Remote Agent";

if (args.Length > 0 && string.Equals(args[0], "install", StringComparison.OrdinalIgnoreCase))
{
    await HandleInstallAsync(args);
    return;
}

if (args.Length > 0 && string.Equals(args[0], "register", StringComparison.OrdinalIgnoreCase))
{
    await HandleRegisterAsync(args);
    return;
}

if (args.Length > 0 && TryHandleServiceCommand(args[0]))
{
    return;
}

// Double-clicked in Explorer (no args, interactive, not the Windows
// Service Control Manager starting it as a service) — non-technical
// recipients shouldn't need to know install/register/start exist as
// separate commands. Detect what's already on this machine and do the
// right thing automatically. See "Deploying"/"Updating" sections in
// agent/README.md.
//
// Gated on IsSingleFileBundle too: without it, "dotnet run --project
// Dreamers.Agent" (documented above as the local dev-run flow — no args,
// interactive, not a service either) would hit this same branch and hijack
// it into the installer instead of actually running the worker. A
// single-file-published exe has no separate assembly file on disk (it's
// bundled into the one .exe), so Assembly.Location is empty; a "dotnet
// build"/"dotnet run" output does have one. That's a reliable way to tell
// "this is the thing we shipped to a recipient" apart from "this is a dev
// build."
#pragma warning disable IL3000 // Deliberate: the always-empty-in-single-file behavior IS the signal we want here, not a path we need.
var isSingleFileBundle = string.IsNullOrEmpty(System.Reflection.Assembly.GetExecutingAssembly().Location);
#pragma warning restore IL3000
if (args.Length == 0 && isSingleFileBundle && Environment.UserInteractive && !WindowsServiceHelpers.IsWindowsService())
{
    await HandleInteractiveSetupAsync();
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
builder.Services.AddSingleton(new AllowedPathsConfigStore(dataDirectory));
builder.Services.AddSingleton<MetricsCollector>();
builder.Services.AddSingleton<CommandExecutor>();
builder.Services.AddSingleton<TestJobRunner>();
builder.Services.AddSingleton<FfmpegJobRunner>();
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

// --- Install as a Windows Service, optionally pairing with the server in
// the same step: DreamersAgent.exe install [registration-token]. Combines
// what used to be 3 separate commands (install, register, start) into 1
// for the common case — installing with no token still works (register
// + start separately later), since some admins may want to double-check
// the service came up cleanly before handing it a real credential.
async Task HandleInstallAsync(string[] commandArgs)
{
    var exePath = Environment.ProcessPath;
    if (string.IsNullOrEmpty(exePath))
    {
        Console.Error.WriteLine("Could not determine the agent's own executable path.");
        return;
    }

    RunSc($"create {ServiceName} binPath= \"{exePath}\" DisplayName= \"{ServiceDisplayName}\" start= auto");
    RunSc($"description {ServiceName} \"Collects workstation metrics and executes whitelisted management commands for Dreamers Remote.\"");
    Console.WriteLine("Service installed.");

    var token = commandArgs.Length > 1 ? commandArgs[1] : null;
    if (!string.IsNullOrWhiteSpace(token))
    {
        if (!await TryRegisterAsync(token))
        {
            Console.WriteLine(
                "Service installed but NOT registered — fix the issue above, then run " +
                "\"DreamersAgent.exe register <token>\" followed by \"DreamersAgent.exe start\".");
            return;
        }
    }
    else
    {
        Console.WriteLine(
            "No registration token provided — run \"DreamersAgent.exe register <token>\" " +
            "whenever you have one; the service will collect and log metrics locally either way.");
    }

    RunSc($"start {ServiceName}");
    Console.WriteLine("Service started.");
}

// --- One-time pairing: DreamersAgent.exe register <token>. The token
// comes from an admin issuing it via POST /api/workstations/:id/agent-token
// (see docs/SECURITY.md) and is single-use/short-lived — the credential
// this returns is what gets stored (via DPAPI) and reused for every
// heartbeat afterward. Kept as its own command (not just folded into
// install) for re-registering an already-installed service, e.g. after
// wiping the credential file.
async Task HandleRegisterAsync(string[] commandArgs)
{
    if (commandArgs.Length < 2 || string.IsNullOrWhiteSpace(commandArgs[1]))
    {
        Console.Error.WriteLine("Usage: DreamersAgent.exe register <registration-token>");
        return;
    }

    if (await TryRegisterAsync(commandArgs[1]))
    {
        Console.WriteLine("Restart the service to start sending heartbeats:");
        Console.WriteLine("  DreamersAgent.exe stop");
        Console.WriteLine("  DreamersAgent.exe start");
    }
}

async Task<bool> TryRegisterAsync(string token)
{
    var dir = AgentConfigStore.DefaultDataDirectory;
    var cfg = new AgentConfigStore(dir).LoadOrCreate();

    using var httpClient = new HttpClient();
    var client = new ServerClient(httpClient, cfg);

    try
    {
        var credential = await client.RegisterAsync(token);
        new AgentCredentialStore(dir).Save(credential);
        Console.WriteLine("Registered successfully.");
        return true;
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"Registration failed: {ex.Message}");
        return false;
    }
}

// --- uninstall/start/stop: thin wrappers around the built-in sc.exe,
// nothing custom.
bool TryHandleServiceCommand(string command)
{
    switch (command.ToLowerInvariant())
    {
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

// --- Double-click install/update.
//
// Elevation is checked and requested here, at the entry to this one flow
// — deliberately NOT via a requireAdministrator app manifest, which would
// force elevation (and a UAC prompt) on every single launch of this exe,
// including "dotnet run --project Dreamers.Agent" (the documented local
// dev-run flow above) and any non-interactive context with no UI to show
// a UAC prompt on at all — both broke outright when this was tried as a
// manifest setting instead.
async Task HandleInteractiveSetupAsync()
{
    if (!IsRunningElevated())
    {
        Console.WriteLine("Can quyen Administrator de cai dat/cap nhat - dang mo lai voi quyen cao hon...");
        var exePath = Environment.ProcessPath;
        if (string.IsNullOrEmpty(exePath))
        {
            Console.WriteLine("Loi: khong xac dinh duoc duong dan file dang chay.");
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo(exePath) { UseShellExecute = true, Verb = "runas" });
        }
        catch (System.ComponentModel.Win32Exception)
        {
            // User clicked "No" on the UAC prompt.
            Console.WriteLine("Da huy quyen Administrator - khong the cai dat/cap nhat.");
            Console.WriteLine("Nhan phim bat ky de dong cua so nay...");
            Console.ReadKey();
        }
        return;
    }

    Console.WriteLine("=========================================================");
    Console.WriteLine(" Dreamers Remote Agent - Cai dat / Cap nhat tu dong");
    Console.WriteLine("=========================================================");
    Console.WriteLine();

    var existingExePath = GetInstalledServiceExePath();
    if (existingExePath is not null && File.Exists(existingExePath))
    {
        await UpdateInPlaceAsync(existingExePath);
    }
    else
    {
        await FreshInteractiveInstallAsync();
    }

    Console.WriteLine();
    Console.WriteLine("Nhan phim bat ky de dong cua so nay...");
    Console.ReadKey();
}

bool IsRunningElevated()
{
    using var identity = WindowsIdentity.GetCurrent();
    return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
}

// Reads HKLM\SYSTEM\CurrentControlSet\Services\DreamersAgent\ImagePath —
// set by "sc create ... binPath= ..." (see HandleInstallAsync /
// FreshInteractiveInstallAsync) — rather than assuming a fixed install
// location, since existing installs on the 4 studio workstations were set
// up by hand at whatever path an admin chose.
string? GetInstalledServiceExePath()
{
    try
    {
        using var key = Registry.LocalMachine.OpenSubKey($@"SYSTEM\CurrentControlSet\Services\{ServiceName}");
        var imagePath = key?.GetValue("ImagePath") as string;
        return string.IsNullOrWhiteSpace(imagePath) ? null : imagePath.Trim().Trim('"');
    }
    catch
    {
        return null;
    }
}

async Task UpdateInPlaceAsync(string existingExePath)
{
    Console.WriteLine($"Da tim thay Agent dang cai dat tai: {existingExePath}");

    var currentExePath = Environment.ProcessPath;
    if (string.IsNullOrEmpty(currentExePath))
    {
        Console.WriteLine("Loi: khong xac dinh duoc duong dan file dang chay - dung lai.");
        return;
    }

    var sameFile = string.Equals(
        Path.GetFullPath(currentExePath), Path.GetFullPath(existingExePath), StringComparison.OrdinalIgnoreCase);

    Console.WriteLine("Dang dung dich vu de cap nhat...");
    RunSc($"stop {ServiceName}");
    if (!await WaitForServiceStateAsync("STOPPED", TimeSpan.FromSeconds(20)))
    {
        Console.WriteLine("Canh bao: dich vu khong bao STOPPED trong thoi gian cho - van thu cap nhat.");
    }

    if (!sameFile)
    {
        try
        {
            await CopyWithRetryAsync(currentExePath, existingExePath);
            Console.WriteLine("Da sao chep file moi vao noi cai dat.");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Loi khi sao chep file: {ex.Message}");
            Console.WriteLine("Dang khoi dong lai dich vu voi ban cu (chua cap nhat)...");
            RunSc($"start {ServiceName}");
            return;
        }
    }
    else
    {
        Console.WriteLine("Ban dang chay dung file da cai dat san - chi khoi dong lai dich vu.");
    }

    Console.WriteLine("Dang khoi dong lai dich vu...");
    RunSc($"start {ServiceName}");
    Console.WriteLine();
    if (await WaitForServiceStateAsync("RUNNING", TimeSpan.FromSeconds(20)))
    {
        Console.WriteLine("HOAN TAT! Agent da duoc CAP NHAT va dang chay.");
    }
    else
    {
        Console.WriteLine("Dich vu chua bao RUNNING trong thoi gian cho. Kiem tra thu cong:");
        Console.WriteLine($"  Get-Service {ServiceName}");
        Console.WriteLine(@"  Get-Content C:\ProgramData\DreamersRemote\logs\agent-*.log -Tail 20");
    }
}

// No existing install found — fresh machine. Installs to a fixed, stable
// location (not wherever this exe happens to be double-clicked from,
// e.g. Desktop/Downloads) since that path gets baked into the service
// definition and needs to still exist on every future boot.
async Task FreshInteractiveInstallAsync()
{
    Console.WriteLine("Chua tim thay Agent nao dang cai dat tren may nay.");
    Console.WriteLine("Bat dau cai dat moi...");
    Console.WriteLine();

    const string targetDir = @"C:\Program Files\DreamersRemote";
    Directory.CreateDirectory(targetDir);
    var targetExePath = Path.Combine(targetDir, "DreamersAgent.exe");

    var currentExePath = Environment.ProcessPath;
    if (string.IsNullOrEmpty(currentExePath))
    {
        Console.WriteLine("Loi: khong xac dinh duoc duong dan file dang chay - dung lai.");
        return;
    }

    if (!string.Equals(Path.GetFullPath(currentExePath), Path.GetFullPath(targetExePath), StringComparison.OrdinalIgnoreCase))
    {
        File.Copy(currentExePath, targetExePath, overwrite: true);
        Console.WriteLine($"Da sao chep vao: {targetDir}");
    }

    RunSc($"create {ServiceName} binPath= \"{targetExePath}\" DisplayName= \"{ServiceDisplayName}\" start= auto");
    RunSc($"description {ServiceName} \"Collects workstation metrics and executes whitelisted management commands for Dreamers Remote.\"");
    Console.WriteLine("Da tao dich vu Windows.");
    Console.WriteLine();

    Console.WriteLine("Neu ban co MA DANG KY (registration token) tu quan tri vien, dan vao day roi nhan Enter.");
    Console.WriteLine("Chua co thi cu nhan Enter de bo qua - Agent van chay va ghi log cuc bo, dang ky sau cung duoc.");
    Console.Write("Ma dang ky: ");
    var token = Console.ReadLine();

    if (!string.IsNullOrWhiteSpace(token))
    {
        if (!await TryRegisterAsync(token.Trim()))
        {
            Console.WriteLine("Dang ky that bai - dich vu van duoc cai va khoi dong. Thu lai dang ky sau bang:");
            Console.WriteLine($"  \"{targetExePath}\" register <ma-dang-ky>");
        }
    }
    else
    {
        Console.WriteLine("Da bo qua dang ky - Agent chi ghi log cuc bo cho den khi duoc dang ky.");
    }

    RunSc($"start {ServiceName}");
    Console.WriteLine();
    if (await WaitForServiceStateAsync("RUNNING", TimeSpan.FromSeconds(20)))
    {
        Console.WriteLine("HOAN TAT! Agent da duoc CAI DAT va dang chay.");
    }
    else
    {
        Console.WriteLine($"Dich vu chua bao RUNNING trong thoi gian cho. Kiem tra: Get-Service {ServiceName}");
    }
}

// SCM reports STOPPED as soon as the service acknowledges the stop
// request, which can land a moment before the .NET process actually
// exits and releases its handle on its own exe — WaitForServiceStateAsync
// above isn't enough on its own. Retry the copy for a few seconds to
// absorb that gap instead of failing and rolling back to the old build.
async Task CopyWithRetryAsync(string sourcePath, string destinationPath)
{
    const int maxAttempts = 10;
    for (var attempt = 1; attempt <= maxAttempts; attempt++)
    {
        try
        {
            File.Copy(sourcePath, destinationPath, overwrite: true);
            return;
        }
        catch (IOException) when (attempt < maxAttempts)
        {
            await Task.Delay(500);
        }
    }
}

async Task<bool> WaitForServiceStateAsync(string expectedState, TimeSpan timeout)
{
    var deadline = DateTime.UtcNow + timeout;
    while (DateTime.UtcNow < deadline)
    {
        if (QueryServiceState()?.Contains(expectedState, StringComparison.OrdinalIgnoreCase) == true)
        {
            return true;
        }
        await Task.Delay(500);
    }
    return false;
}

string? QueryServiceState()
{
    var psi = new ProcessStartInfo("sc.exe", $"query {ServiceName}")
    {
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        UseShellExecute = false,
    };

    using var process = Process.Start(psi);
    if (process is null) return null;

    var output = process.StandardOutput.ReadToEnd();
    process.WaitForExit();
    return output;
}
