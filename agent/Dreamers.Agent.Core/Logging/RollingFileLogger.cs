using Microsoft.Extensions.Logging;

namespace Dreamers.Agent.Core.Logging;

/// <summary>
/// Writes one line per log entry to C:\ProgramData\DreamersRemote\logs\agent-YYYYMMDD.log.
/// Opens/appends/closes the file per write rather than holding a handle
/// open for the service's lifetime — simpler and safe across day rollover,
/// and the agent's log volume (a message every few seconds at most) makes
/// the per-write open/close cost irrelevant.
/// </summary>
internal sealed class RollingFileLogger : ILogger
{
    private readonly string _categoryName;
    private readonly string _directory;
    private readonly object _writeLock;

    public RollingFileLogger(string categoryName, string directory, object writeLock)
    {
        _categoryName = categoryName;
        _directory = directory;
        _writeLock = writeLock;
    }

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        if (!IsEnabled(logLevel))
        {
            return;
        }

        var line = $"{DateTime.UtcNow:yyyy-MM-dd HH:mm:ss.fff} [{logLevel}] {_categoryName}: {formatter(state, exception)}";
        if (exception is not null)
        {
            line += Environment.NewLine + exception;
        }

        var path = Path.Combine(_directory, $"agent-{DateTime.UtcNow:yyyyMMdd}.log");

        lock (_writeLock)
        {
            try
            {
                File.AppendAllText(path, line + Environment.NewLine);
            }
            catch
            {
                // A logging failure must never crash the agent.
            }
        }
    }
}
