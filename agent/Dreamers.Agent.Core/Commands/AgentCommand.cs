namespace Dreamers.Agent.Core.Commands;

/// <summary>
/// Structured whitelist only — never arbitrary shell. Mirrors the server's
/// AGENT_COMMANDS whitelist (server/src/agent/commands.ts). See
/// docs/SECURITY.md's command-security principles.
/// </summary>
public enum AgentCommand
{
    Restart,
    Shutdown,

    /// <summary>
    /// "From now on, take jobs from me." Sent by whichever server the
    /// operator picked in its dashboard, so job ownership can be moved
    /// without walking to the machine.
    ///
    /// Not an OS action like the two above — CommandExecutor never sees
    /// it; Worker applies it to the config and to its own running state.
    /// </summary>
    ClaimJobs,
}

public static class AgentCommandParser
{
    public static bool TryParse(string? value, out AgentCommand command)
    {
        switch (value?.ToLowerInvariant())
        {
            case "restart":
                command = AgentCommand.Restart;
                return true;
            case "shutdown":
                command = AgentCommand.Shutdown;
                return true;
            case "claim-jobs":
                command = AgentCommand.ClaimJobs;
                return true;
            default:
                command = default;
                return false;
        }
    }
}
