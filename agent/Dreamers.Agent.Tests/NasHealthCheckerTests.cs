using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Credentials;
using Dreamers.Agent.Core.Ffmpeg;
using Xunit;

namespace Dreamers.Agent.Tests;

// These only exercise the two checks that resolve before any real
// network call (no allowed roots / no credential) -- an actual
// authenticate-then-read-then-write check needs a real SMB share, which
// this dev machine doesn't have (see FfmpegJobRunnerTests's doc
// comment for the equivalent ffmpeg.exe constraint).
public class NasHealthCheckerTests
{
    private static string CreateTempDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), "DreamersNasHealthTests_" + Guid.NewGuid());
        Directory.CreateDirectory(path);
        return path;
    }

    [Fact]
    public void NotConfigured_WhenNoAllowedRootsAreSet()
    {
        var dir = CreateTempDirectory();
        try
        {
            var allowedPaths = new AllowedPathsConfigStore(dir); // deny-all default
            var nasCredentials = new NasCredentialStore(dir);

            var result = NasHealthChecker.Check(nasCredentials, allowedPaths);

            Assert.Equal(NasConnectCategory.NotConfigured, result.Category);
            Assert.False(result.Ok);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void Authentication_WhenAllowedRootsAreSetButNoCredentialIsSaved()
    {
        var dir = CreateTempDirectory();
        try
        {
            var allowedPaths = new AllowedPathsConfigStore(dir);
            allowedPaths.Save(new AllowedPathsConfig { AllowedRoots = new List<string> { "\\\\nas\\Projects" } });
            var nasCredentials = new NasCredentialStore(dir); // never saved

            var result = NasHealthChecker.Check(nasCredentials, allowedPaths);

            Assert.Equal(NasConnectCategory.Authentication, result.Category);
            Assert.False(result.Ok);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Theory]
    [InlineData(@"\\192.29.11.92\web_data\www\Projects\SOURCE\a.mov", @"\\192.29.11.92\web_data")]
    [InlineData(@"\\nas\Projects", @"\\nas\Projects")]
    [InlineData(@"C:\local\file.mov", null)]
    public void ExtractShareRoot_ReturnsTheHostAndShareOnly(string uncPath, string? expected)
    {
        Assert.Equal(expected, NasConnector.ExtractShareRoot(uncPath));
    }
}
