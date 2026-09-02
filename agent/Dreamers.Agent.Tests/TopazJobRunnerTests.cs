using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Credentials;
using Dreamers.Agent.Core.Jobs;
using Xunit;

namespace Dreamers.Agent.Tests;

// Mirrors FfmpegJobRunnerTests.cs: exercises TopazJobRunner's own
// validation before it ever spawns Topaz's ffmpeg.exe -- doesn't
// require Topaz Video AI to actually be installed on the machine
// running the test suite. A real upscale end-to-end can only be
// verified on a workstation that has it (see docs/PROJECT_STATUS.md's
// Phase 4 test notes).
public class TopazJobRunnerTests
{
    private static TopazJobRunner NewRunner(params string[] allowedRoots)
    {
        var dir = Path.Combine(Path.GetTempPath(), "dreamers-agent-tests-" + Guid.NewGuid());
        var pathsStore = new AllowedPathsConfigStore(dir);
        pathsStore.Save(new AllowedPathsConfig { AllowedRoots = allowedRoots.ToList() });
        var nasCredentialStore = new NasCredentialStore(dir);
        var topazConfigStore = new TopazConfigStore(dir);
        return new TopazJobRunner(pathsStore, nasCredentialStore, topazConfigStore);
    }

    private static async Task<JobSnapshot> WaitForFinishedAsync(TopazJobRunner runner, int jobId)
    {
        for (var i = 0; i < 50; i++)
        {
            var s = runner.GetSnapshots().SingleOrDefault(x => x.JobId == jobId);
            if (s is { Finished: true }) return s;
            await Task.Delay(50);
        }
        throw new TimeoutException("Runner never reported a finished snapshot");
    }

    [Fact]
    public async Task RejectsASourcePathOutsideAllowedRoots()
    {
        var runner = NewRunner("\\\\nas\\Projects");
        var input = """{"sourcePath":"C:\\evil\\in.mov","outputPath":"\\\\nas\\Projects\\out.mp4","model":"iris-2","scale":2,"codec":"h264_nvenc","qualityMode":"cq"}""";

        runner.Start(1, input, null);
        var finished = await WaitForFinishedAsync(runner, 1);

        Assert.False(finished.Success);
        Assert.Contains("sourcePath", finished.Error);
    }

    [Fact]
    public async Task RejectsAnOutputPathOutsideAllowedRoots()
    {
        var runner = NewRunner("\\\\nas\\Projects");
        var input = """{"sourcePath":"\\\\nas\\Projects\\in.mov","outputPath":"C:\\evil\\out.mp4","model":"iris-2","scale":2,"codec":"h264_nvenc","qualityMode":"cq"}""";

        runner.Start(1, input, null);
        var finished = await WaitForFinishedAsync(runner, 1);

        Assert.False(finished.Success);
        Assert.Contains("outputPath", finished.Error);
    }

    [Fact]
    public async Task FailsWithAClearErrorWhenNoAllowedRootsAreConfigured()
    {
        var runner = NewRunner(); // deny-all default
        var input = """{"sourcePath":"\\\\nas\\Projects\\in.mov","outputPath":"\\\\nas\\Projects\\out.mp4","model":"iris-2","scale":2,"codec":"h264_nvenc","qualityMode":"cq"}""";

        runner.Start(1, input, null);
        var finished = await WaitForFinishedAsync(runner, 1);

        Assert.False(finished.Success);
    }

    [Fact]
    public async Task FailsWhenTheSourceFileDoesNotExist()
    {
        var runner = NewRunner("\\\\nas\\Projects");
        var input = """{"sourcePath":"\\\\nas\\Projects\\does-not-exist-12345.mov","outputPath":"\\\\nas\\Projects\\out.mp4","model":"iris-2","scale":2,"codec":"h264_nvenc","qualityMode":"cq"}""";

        runner.Start(1, input, null);
        var finished = await WaitForFinishedAsync(runner, 1);

        Assert.False(finished.Success);
        Assert.Contains("does not exist", finished.Error);
    }

    [Fact]
    public void StartWithTheSameJobIdTwiceThrows()
    {
        var runner = NewRunner("\\\\nas\\Projects");
        var input = """{"sourcePath":"\\\\nas\\Projects\\does-not-exist.mov","outputPath":"\\\\nas\\Projects\\out.mp4","model":"iris-2","scale":2,"codec":"h264_nvenc","qualityMode":"cq"}""";

        runner.Start(1, input, null);
        Assert.Throws<InvalidOperationException>(() => runner.Start(1, input, null));
    }

    // P4-3H: two different job ids on the same runner instance must be
    // tracked independently -- see FfmpegJobRunnerTests' identical case
    // for the full rationale (this is what lets one ffmpeg + one topaz,
    // or two topaz jobs, actually run concurrently on two GPU slots).
    [Fact]
    public async Task StartTwoDifferentJobIdsDoesNotThrowAndBothResolveIndependently()
    {
        var runner = NewRunner(); // deny-all -- both fail fast, which is fine for this test
        var input = """{"sourcePath":"\\\\nas\\Projects\\in.mov","outputPath":"\\\\nas\\Projects\\out.mp4","model":"iris-2","scale":2,"codec":"h264_nvenc","qualityMode":"cq"}""";

        runner.Start(1, input, null);
        runner.Start(2, input, null); // must not throw -- old design would have

        var f1 = await WaitForFinishedAsync(runner, 1);
        var f2 = await WaitForFinishedAsync(runner, 2);
        Assert.False(f1.Success);
        Assert.False(f2.Success);
    }

    [Fact]
    public async Task ResetAfterFinishingAllowsStartingAnotherJobWithTheSameId()
    {
        var runner = NewRunner(); // deny-all -- fails fast, which is fine for this test
        var input = """{"sourcePath":"\\\\nas\\Projects\\in.mov","outputPath":"\\\\nas\\Projects\\out.mp4","model":"iris-2","scale":2,"codec":"h264_nvenc","qualityMode":"cq"}""";

        runner.Start(1, input, null);
        await WaitForFinishedAsync(runner, 1);
        runner.Reset(1);

        runner.Start(1, input, null);
        Assert.NotNull(runner.GetSnapshots().SingleOrDefault(s => s.JobId == 1));
    }
}
