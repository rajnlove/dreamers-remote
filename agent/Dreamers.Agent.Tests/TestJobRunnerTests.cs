using Dreamers.Agent.Core.Jobs;
using Xunit;

namespace Dreamers.Agent.Tests;

public class TestJobRunnerTests
{
    [Fact]
    public async Task Start_RunsToCompletion_ReportingFullProgress()
    {
        var runner = new TestJobRunner();
        runner.Start(jobId: 1, inputJson: """{"seconds":1}""");

        Assert.True(runner.IsBusy);

        await Task.Delay(TimeSpan.FromSeconds(1.5));

        Assert.False(runner.IsBusy);
        var snapshot = runner.GetSnapshot();
        Assert.NotNull(snapshot);
        Assert.Equal(1, snapshot!.JobId);
        Assert.True(snapshot.Finished);
        Assert.True(snapshot.Success);
        Assert.Equal(100, snapshot.Progress);
        Assert.Null(snapshot.Error);
    }

    [Fact]
    public void Start_WhileAlreadyBusy_Throws()
    {
        var runner = new TestJobRunner();
        runner.Start(jobId: 1, inputJson: """{"seconds":5}""");

        Assert.Throws<InvalidOperationException>(() => runner.Start(jobId: 2, inputJson: null));
    }

    [Fact]
    public async Task Reset_AfterFinishing_AllowsStartingAnotherJob()
    {
        var runner = new TestJobRunner();
        runner.Start(jobId: 1, inputJson: """{"seconds":1}""");
        await Task.Delay(TimeSpan.FromSeconds(1.5));
        Assert.False(runner.IsBusy);

        runner.Reset();
        runner.Start(jobId: 2, inputJson: """{"seconds":1}""");

        Assert.True(runner.IsBusy);
        Assert.Equal(2, runner.GetSnapshot()!.JobId);
    }

    [Fact]
    public void Start_WithMalformedInput_DoesNotThrowSynchronously()
    {
        var runner = new TestJobRunner();
        // Falls back to the default duration rather than failing — this
        // must not throw at Start() time regardless of how bad the JSON is.
        runner.Start(jobId: 1, inputJson: "not json at all");
        Assert.True(runner.IsBusy);
    }

    [Fact]
    public async Task Cancel_StopsTheRunningJob_WithNoFinishedSnapshotToReport()
    {
        var runner = new TestJobRunner();
        runner.Start(jobId: 1, inputJson: """{"seconds":10}""");

        runner.Cancel(1);
        // Give the cancelled Task.Delay a moment to actually unwind.
        await Task.Delay(TimeSpan.FromMilliseconds(200));

        Assert.False(runner.IsBusy);
        Assert.Null(runner.GetSnapshot());
    }

    [Fact]
    public void Cancel_WithMismatchedJobId_IsANoOp()
    {
        var runner = new TestJobRunner();
        runner.Start(jobId: 1, inputJson: """{"seconds":10}""");

        runner.Cancel(999);

        Assert.True(runner.IsBusy);
        Assert.Equal(1, runner.GetSnapshot()!.JobId);
    }

    [Fact]
    public async Task Cancel_AfterAlreadyFinished_DoesNotClearTheFinishedSnapshot()
    {
        var runner = new TestJobRunner();
        runner.Start(jobId: 1, inputJson: """{"seconds":1}""");
        await Task.Delay(TimeSpan.FromSeconds(1.5));

        runner.Cancel(1);

        var snapshot = runner.GetSnapshot();
        Assert.NotNull(snapshot);
        Assert.True(snapshot!.Finished);
        Assert.True(snapshot.Success);
    }
}
