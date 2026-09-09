using Dreamers.Agent.Core.Commands;
using Xunit;

namespace Dreamers.Agent.Tests;

/// <summary>
/// claim-jobs moves job ownership between servers from a dashboard,
/// instead of someone editing agent.json on the machine.
///
/// It travels the same whitelist as restart/shutdown but is not an OS
/// action, so the tests below pin both halves: it must parse, and it must
/// never reach the executor that shells out to shutdown.exe.
/// </summary>
public sealed class ClaimJobsCommandTests
{
    [Fact]
    public void Parses_FromTheWireName()
    {
        Assert.True(AgentCommandParser.TryParse("claim-jobs", out var command));
        Assert.Equal(AgentCommand.ClaimJobs, command);
    }

    [Theory]
    [InlineData("CLAIM-JOBS")]
    [InlineData("Claim-Jobs")]
    public void Parses_RegardlessOfCase(string wire)
    {
        Assert.True(AgentCommandParser.TryParse(wire, out var command));
        Assert.Equal(AgentCommand.ClaimJobs, command);
    }

    [Theory]
    [InlineData("claim_jobs")]
    [InlineData("claimjobs")]
    [InlineData("claim jobs")]
    [InlineData("")]
    [InlineData(null)]
    public void DoesNotParse_FromANearMiss(string? wire)
    {
        // The whitelist is exact on purpose: an unrecognised command is
        // logged and dropped, never guessed at.
        Assert.False(AgentCommandParser.TryParse(wire, out _));
    }

    [Fact]
    public void TheOsCommandsStillParse()
    {
        Assert.True(AgentCommandParser.TryParse("restart", out var restart));
        Assert.Equal(AgentCommand.Restart, restart);
        Assert.True(AgentCommandParser.TryParse("shutdown", out var shutdown));
        Assert.Equal(AgentCommand.Shutdown, shutdown);
    }

    [Fact]
    public void CommandExecutor_RefusesClaimJobs()
    {
        // Worker intercepts ClaimJobs before this point. If that
        // interception is ever removed, this machine would try to run
        // "shutdown.exe" with arguments for a config change — so the
        // executor throws rather than doing something arbitrary.
        var executor = new CommandExecutor();
        Assert.Throws<ArgumentOutOfRangeException>(() => executor.Execute(AgentCommand.ClaimJobs));
    }
}
