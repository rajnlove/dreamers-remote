using System.Management;

namespace Dreamers.Agent.Core.Metrics;

/// <summary>
/// CPU name + physical core count don't change while the agent runs, so
/// this is read once (via WMI, the simplest reliable source for both
/// values together) and cached by <see cref="CpuCollector"/> rather than
/// queried on every tick.
/// </summary>
internal static class CpuIdentity
{
    internal static (string Name, int PhysicalCoreCount) Read(int logicalProcessorCountFallback)
    {
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT Name, NumberOfCores FROM Win32_Processor");
            foreach (ManagementBaseObject obj in searcher.Get())
            {
                var name = obj["Name"]?.ToString()?.Trim();
                var cores = obj["NumberOfCores"] is { } value ? Convert.ToInt32(value) : logicalProcessorCountFallback;
                return (string.IsNullOrWhiteSpace(name) ? "Unknown CPU" : name, cores);
            }
        }
        catch
        {
            // WMI unavailable/broken — a missing CPU name must not stop
            // the rest of the snapshot from being collected.
        }

        return ("Unknown CPU", logicalProcessorCountFallback);
    }
}
