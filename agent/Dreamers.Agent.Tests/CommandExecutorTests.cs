using Dreamers.Agent.Core.Commands;
using Xunit;

namespace Dreamers.Agent.Tests;

public class AgentCommandParserTests
{
    [Theory]
    [InlineData("restart", AgentCommand.Restart)]
    [InlineData("RESTART", AgentCommand.Restart)]
    [InlineData("shutdown", AgentCommand.Shutdown)]
    public void TryParse_AcceptsWhitelistedValues(string value, AgentCommand expected)
    {
        Assert.True(AgentCommandParser.TryParse(value, out var command));
        Assert.Equal(expected, command);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("format-c")]
    [InlineData("shutdown; rm -rf /")]
    public void TryParse_RejectsAnythingElse(string? value)
    {
        Assert.False(AgentCommandParser.TryParse(value, out _));
    }
}

public class CommandExecutorTests
{
    [Fact]
    public void BuildArguments_Restart_UsesRestartFlag()
    {
        Assert.Contains("/r", CommandExecutor.BuildArguments(AgentCommand.Restart));
    }

    [Fact]
    public void BuildArguments_Shutdown_UsesShutdownFlag()
    {
        Assert.Contains("/s", CommandExecutor.BuildArguments(AgentCommand.Shutdown));
    }
}
