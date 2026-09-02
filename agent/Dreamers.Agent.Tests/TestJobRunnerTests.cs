using Dreamers.Agent.Core.Jobs;
using Xunit;

namespace Dreamers.Agent.Tests;

public class TestJobRunnerTests
{
    private static JobSnapshot? SnapshotFor(TestJobRunner runner, int jobId) =>
        runner.GetSnapshots().SingleOrDefault(s => s.JobId == jobId);

    [Fact]
    public async Task Start_RunsToCompletion_ReportingFullProgress()
    {
        var runner = new TestJobRunner();
        runner.Start(jobId: 1, inputJson: """{"seconds":1}""", gpuSlot: null);

        Assert.NotNull(SnapshotFor(runner, 1));

        await Task.Delay(TimeSpan.FromSeconds(1.5));

        var snapshot = SnapshotFor(runner, 1);
        Assert.NotNull(snapshot);
        Assert.Equal(1, snapshot!.JobId);
        Assert.True(snapshot.Finished);
        Assert.True(snapshot.Success);
        Assert.Equal(100, snapshot.Progress);
        Assert.Null(snapshot.Error);
    }

    [Fact]
    public void Start_WhileTheSameJobIdAlreadyRunning_Throws()
    {
        var runner = new TestJobRunner();
        runner.Start(jobId: 1, inputJson: """{"seconds":5}""", gpuSlot: null);

        Assert.Throws<InvalidOperationException>(() => runner.Start(jobId: 1, inputJson: null, gpuSlot: null));
    }

    // P4-3H: the core behavior this milestone adds — two jobs started on
    // the SAME runner instance (same job type) actually run at the same
    // time, tracked independently by id, instead of the second one being
    // rejected/blocked until the first finishes. This is what was
    // verified live against CGI-Render's two GPUs on 2026-09-02.
    [Fact]
    public async Task Start_TwoDifferentJobIds_RunConcurrently()
    {
        var runner = new TestJobRunner();
        runner.Start(jobId: 1, inputJson: """{"seconds":2}""", gpuSlot: 0);
        runner.Start(jobId: 2, inputJson: """{"seconds":2}""", gpuSlot: 1);

        await Task.Delay(TimeSpan.FromMilliseconds(500));

        // Both must be alive and progressing at the same time -- if the
        // old single-slot design were still in place, Start() for job 2
        // would have thrown outright.
        var s1 = SnapshotFor(runner, 1);
        var s2 = SnapshotFor(runner, 2);
        Assert.NotNull(s1);
        Assert.NotNull(s2);
        Assert.False(s1!.Finished);
        Assert.False(s2!.Finished);

        await Task.Delay(TimeSpan.FromSeconds(2));

        Assert.True(SnapshotFor(runner, 1)!.Finished);
        Assert.True(SnapshotFor(runner, 2)!.Finished);
    }

    [Fact]
    public async Task Reset_AfterFinishing_AllowsStartingAnotherJobWithTheSameId()
    {
        var runner = new TestJobRunner();
        runner.Start(jobId: 1, inputJson: """{"seconds":1}""", gpuSlot: null);
        await Task.Delay(TimeSpan.FromSeconds(1.5));
        Assert.True(SnapshotFor(runner, 1)!.Finished);

        runner.Reset(1);
        Assert.Null(SnapshotFor(runner, 1));

        runner.Start(jobId: 2, inputJson: """{"seconds":1}""", gpuSlot: null);
        Assert.NotNull(SnapshotFor(runner, 2));
    }

    [Fact]
    public void Start_WithMalformedInput_DoesNotThrowSynchronously()
    {
        var runner = new TestJobRunner();
        // Falls back to the default duration rather than failing — this
        // must not throw at Start() time regardless of how bad the JSON is.
        runner.Start(jobId: 1, inputJson: "not json at all", gpuSlot: null);
        Assert.NotNull(SnapshotFor(runner, 1));
    }

    [Fact]
    public async Task Cancel_StopsTheRunningJob_WithNoFinishedSnapshotToReport()
    {
        var runner = new TestJobRunner();
        runner.Start(jobId: 1, inputJson: """{"seconds":10}""", gpuSlot: null);

        runner.Cancel(1);
        // Give the cancelled Task.Delay a moment to actually unwind.
        await Task.Delay(TimeSpan.FromMilliseconds(200));

        Assert.Null(SnapshotFor(runner, 1));
    }

    [Fact]
    public void Cancel_WithMismatchedJobId_IsANoOp()
    {
        var runner = new TestJobRunner();
        runner.Start(jobId: 1, inputJson: """{"seconds":10}""", gpuSlot: null);

        runner.Cancel(999);

        Assert.Equal(1, SnapshotFor(runner, 1)!.JobId);
    }

    [Fact]
    public async Task Cancel_AfterAlreadyFinished_DoesNotClearTheFinishedSnapshot()
    {
        var runner = new TestJobRunner();
        runner.Start(jobId: 1, inputJson: """{"seconds":1}""", gpuSlot: null);
        await Task.Delay(TimeSpan.FromSeconds(1.5));

        runner.Cancel(1);

        var snapshot = SnapshotFor(runner, 1);
        Assert.NotNull(snapshot);
        Assert.True(snapshot!.Finished);
        Assert.True(snapshot.Success);
    }
}
