namespace Dreamers.Agent.Core.Configuration;

/// <summary>
/// Persisted to C:\ProgramData\DreamersRemote\monitored_processes.json.
/// Entries are exe names (e.g. "AfterFX.exe") or a "*" prefix wildcard
/// (e.g. "Nuke*.exe", since Nuke's exe name includes its version number).
/// Editable by hand; the agent only reads this, never writes to it after
/// the initial default file is created.
/// </summary>
public sealed class MonitoredProcessesConfig
{
    public List<string> ProcessNames { get; set; } = new()
    {
        "AfterFX.exe",
        "Cinema4D.exe",
        "houdini.exe",
        "houdinifx.exe",
        "hbatch.exe",
        "hython.exe",
        "Nuke*.exe",
        "maya.exe",
        "3dsmax.exe",
        "blender.exe",
    };
}
