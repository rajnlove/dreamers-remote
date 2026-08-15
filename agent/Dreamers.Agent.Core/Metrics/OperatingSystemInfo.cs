using System.Management;

namespace Dreamers.Agent.Core.Metrics;

internal static class OperatingSystemInfo
{
    internal static (string Caption, string Version) Read()
    {
        using var searcher = new ManagementObjectSearcher("SELECT Caption, Version FROM Win32_OperatingSystem");
        foreach (ManagementBaseObject obj in searcher.Get())
        {
            var caption = obj["Caption"]?.ToString()?.Trim();
            var version = obj["Version"]?.ToString();
            return (
                string.IsNullOrWhiteSpace(caption) ? "Unknown Windows" : caption,
                string.IsNullOrWhiteSpace(version) ? Environment.OSVersion.VersionString : version);
        }

        throw new InvalidOperationException("Win32_OperatingSystem query returned no rows");
    }
}
