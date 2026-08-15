using Dreamers.Agent.Core.Logging;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Dreamers.Agent.Tests;

public class RollingFileLoggerTests
{
    [Fact]
    public void Logger_WritesLogLineToDailyFile()
    {
        var dir = Path.Combine(Path.GetTempPath(), "DreamersAgentLogTests_" + Guid.NewGuid());
        Directory.CreateDirectory(dir);
        try
        {
            using var provider = new RollingFileLoggerProvider(new RollingFileLoggerOptions { Directory = dir });
            var logger = provider.CreateLogger("Test");

            logger.LogInformation("hello from test");

            var expectedFile = Path.Combine(dir, $"agent-{DateTime.UtcNow:yyyyMMdd}.log");
            Assert.True(File.Exists(expectedFile));
            Assert.Contains("hello from test", File.ReadAllText(expectedFile));
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void CleanupOldLogs_DeletesFilesOlderThanRetainDays()
    {
        var dir = Path.Combine(Path.GetTempPath(), "DreamersAgentLogTests_" + Guid.NewGuid());
        Directory.CreateDirectory(dir);
        try
        {
            var oldFile = Path.Combine(dir, "agent-20200101.log");
            File.WriteAllText(oldFile, "stale");
            File.SetLastWriteTimeUtc(oldFile, DateTime.UtcNow.AddDays(-30));

            using var provider = new RollingFileLoggerProvider(new RollingFileLoggerOptions { Directory = dir, RetainDays = 14 });

            Assert.False(File.Exists(oldFile));
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }
}
