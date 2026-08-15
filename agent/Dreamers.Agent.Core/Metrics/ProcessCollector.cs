using System.Diagnostics;
using Dreamers.Agent.Core.Configuration;

namespace Dreamers.Agent.Core.Metrics;

/// <summary>
/// Checks the configured VFX process names/patterns against currently
/// running processes. PID/RAM/start time are best-effort — a process
/// this agent can't fully inspect (permissions, protected process) still
/// counts as "Running", just without the extra detail.
/// </summary>
public sealed class ProcessCollector
{
    private readonly IReadOnlyList<string> _monitoredPatterns;

    public ProcessCollector(MonitoredProcessesConfig config)
    {
        _monitoredPatterns = config.ProcessNames;
    }

    public IReadOnlyList<ProcessSnapshot> Collect()
    {
        var runningProcesses = Process.GetProcesses();
        try
        {
            var results = new List<ProcessSnapshot>(_monitoredPatterns.Count);

            foreach (var pattern in _monitoredPatterns)
            {
                results.Add(BuildSnapshot(pattern, FindMatch(runningProcesses, pattern)));
            }

            return results;
        }
        finally
        {
            foreach (var process in runningProcesses)
            {
                process.Dispose();
            }
        }
    }

    private static Process? FindMatch(Process[] processes, string pattern)
    {
        foreach (var process in processes)
        {
            string exeName;
            try
            {
                exeName = process.ProcessName + ".exe";
            }
            catch
            {
                continue;
            }

            if (MatchesPattern(exeName, pattern))
            {
                return process;
            }
        }

        return null;
    }

    private static bool MatchesPattern(string exeName, string pattern)
    {
        var starIndex = pattern.IndexOf('*');
        if (starIndex >= 0)
        {
            var prefix = pattern[..starIndex];
            return exeName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
        }

        return string.Equals(exeName, pattern, StringComparison.OrdinalIgnoreCase);
    }

    private static ProcessSnapshot BuildSnapshot(string pattern, Process? process)
    {
        if (process is null)
        {
            return new ProcessSnapshot { Name = pattern, Running = false };
        }

        long? ramMb = null;
        try
        {
            ramMb = process.WorkingSet64 / (1024 * 1024);
        }
        catch
        {
            // Best-effort — still report the process as running.
        }

        return new ProcessSnapshot
        {
            Name = pattern,
            Running = true,
            Pid = process.Id,
            RamMb = ramMb,
            StartTimeUtc = SafeGetStartTime(process),
        };
    }

    private static DateTime? SafeGetStartTime(Process process)
    {
        try
        {
            return process.StartTime.ToUniversalTime();
        }
        catch
        {
            // Some processes throw Access Denied reading StartTime even
            // when other properties succeed (elevated, protected, or a
            // different user session).
            return null;
        }
    }
}
