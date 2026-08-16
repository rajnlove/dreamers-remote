using System.Diagnostics;

namespace Dreamers.Agent.Core.Commands;

/// <summary>
/// Executes a whitelisted AgentCommand via the built-in Windows
/// shutdown.exe — never a general shell (see docs/SECURITY.md). The delay
/// gives Worker.cs time to POST the result back to the server before the
/// machine actually goes down/reboots.
/// </summary>
public sealed class CommandExecutor
{
    private const int DelaySeconds = 10;

    public static string BuildArguments(AgentCommand command) => command switch
    {
        AgentCommand.Restart => $"/r /t {DelaySeconds} /c \"Requested via Dreamers Remote dashboard\"",
        AgentCommand.Shutdown => $"/s /t {DelaySeconds} /c \"Requested via Dreamers Remote dashboard\"",
        _ => throw new ArgumentOutOfRangeException(nameof(command), command, "Unhandled AgentCommand"),
    };

    public void Execute(AgentCommand command)
    {
        var psi = new ProcessStartInfo("shutdown.exe", BuildArguments(command))
        {
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        Process.Start(psi);
    }
}
