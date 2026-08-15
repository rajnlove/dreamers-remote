namespace Dreamers.Agent.Core.Logging;

public sealed class RollingFileLoggerOptions
{
    /// <summary>Directory the daily log files are written into.</summary>
    public string Directory { get; set; } = string.Empty;

    /// <summary>Log files older than this are deleted on startup.</summary>
    public int RetainDays { get; set; } = 14;
}
