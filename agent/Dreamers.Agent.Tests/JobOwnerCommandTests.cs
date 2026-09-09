using Dreamers.Agent.Core.Commands;
using Xunit;

namespace Dreamers.Agent.Tests;

/// <summary>
/// claim-jobs / release-jobs are the two ends of the dashboard switch
/// that moves job ownership between servers, instead of someone editing
/// agent.json on the machine.
///
/// They travel the same whitelist as restart/shutdown but are not OS
/// actions, so the tests below pin both halves: each must parse, and
/// neither must ever reach the executor that shells out to shutdown.exe
/// (Worker intercepts them first — see Worker.ApplyJobOwnershipAsync).
/// </summary>
public sealed class JobOwnerCommandTests
{
    [Theory]
    [InlineData("claim-jobs", AgentCommand.ClaimJobs)]
    [InlineData("release-jobs", AgentCommand.ReleaseJobs)]
    public void Parses_FromTheWireName(string wire, AgentCommand expected)
    {
        Assert.True(AgentCommandParser.TryParse(wire, out var command));
        Assert.Equal(expected, command);
    }

    [Theory]
    [InlineData("CLAIM-JOBS", AgentCommand.ClaimJobs)]
    [InlineData("Claim-Jobs", AgentCommand.ClaimJobs)]
    [InlineData("RELEASE-JOBS", AgentCommand.ReleaseJobs)]
    [InlineData("Release-Jobs", AgentCommand.ReleaseJobs)]
    public void Parses_RegardlessOfCase(string wire, AgentCommand expected)
    {
        Assert.True(AgentCommandParser.TryParse(wire, out var command));
        Assert.Equal(expected, command);
    }

    [Theory]
    [InlineData("claim_jobs")]
    [InlineData("claimjobs")]
    [InlineData("claim jobs")]
    [InlineData("release_jobs")]
    [InlineData("releasejobs")]
    [InlineData("release")]
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

    [Theory]
    [InlineData(AgentCommand.ClaimJobs)]
    [InlineData(AgentCommand.ReleaseJobs)]
    public void CommandExecutor_RefusesJobOwnerCommands(AgentCommand command)
    {
        // Worker intercepts these before this point. If that interception
        // is ever removed, this machine would try to run "shutdown.exe"
        // with arguments for a config change — so the executor throws
        // rather than doing something arbitrary.
        var executor = new CommandExecutor();
        Assert.Throws<ArgumentOutOfRangeException>(() => executor.Execute(command));
    }
}
