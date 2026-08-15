using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace Dreamers.Agent.Core.Logging;

public sealed class RollingFileLoggerProvider : ILoggerProvider
{
    private readonly RollingFileLoggerOptions _options;
    private readonly object _writeLock = new();
    private readonly ConcurrentDictionary<string, RollingFileLogger> _loggers = new();

    public RollingFileLoggerProvider(RollingFileLoggerOptions options)
    {
        _options = options;
        Directory.CreateDirectory(_options.Directory);
        CleanupOldLogs();
    }

    public ILogger CreateLogger(string categoryName) =>
        _loggers.GetOrAdd(categoryName, name => new RollingFileLogger(name, _options.Directory, _writeLock));

    public void Dispose() => _loggers.Clear();

    private void CleanupOldLogs()
    {
        try
        {
            var cutoff = DateTime.UtcNow.Date.AddDays(-_options.RetainDays);
            foreach (var file in Directory.GetFiles(_options.Directory, "agent-*.log"))
            {
                if (File.GetLastWriteTimeUtc(file).Date < cutoff)
                {
                    File.Delete(file);
                }
            }
        }
        catch
        {
            // Best-effort cleanup — must never prevent the agent from starting.
        }
    }
}
