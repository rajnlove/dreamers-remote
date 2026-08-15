using System.Management;

namespace Dreamers.Agent.Core.Metrics;

public sealed class MemoryCollector
{
    public MemorySnapshot Collect()
    {
        using var searcher = new ManagementObjectSearcher(
            "SELECT TotalVisibleMemorySize, FreePhysicalMemory FROM Win32_OperatingSystem");

        foreach (ManagementBaseObject obj in searcher.Get())
        {
            var totalKb = Convert.ToInt64(obj["TotalVisibleMemorySize"]);
            var freeKb = Convert.ToInt64(obj["FreePhysicalMemory"]);
            var usedKb = totalKb - freeKb;

            return new MemorySnapshot
            {
                TotalMb = totalKb / 1024,
                UsedMb = usedKb / 1024,
                AvailableMb = freeKb / 1024,
                UsagePercent = totalKb > 0 ? Math.Round(usedKb * 100.0 / totalKb, 1) : 0,
            };
        }

        throw new InvalidOperationException("Win32_OperatingSystem query returned no rows");
    }
}
