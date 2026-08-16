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
            default:
                command = default;
                return false;
        }
    }
}
