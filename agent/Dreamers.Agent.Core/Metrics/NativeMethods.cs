using System.Runtime.InteropServices;

namespace Dreamers.Agent.Core.Metrics;

/// <summary>
/// Thin P/Invoke wrappers so CPU utilization and uptime don't need WMI —
/// these two values are sampled every heartbeat interval, so the lightest
/// possible call matters more here than for the one-time identity reads
/// (CPU name, OS caption) that go through WMI in <see cref="CpuIdentity"/>
/// and <see cref="OperatingSystemInfo"/>.
/// </summary>
internal static class NativeMethods
{
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetSystemTimes(
        out System.Runtime.InteropServices.ComTypes.FILETIME idleTime,
        out System.Runtime.InteropServices.ComTypes.FILETIME kernelTime,
        out System.Runtime.InteropServices.ComTypes.FILETIME userTime);

    [DllImport("kernel32.dll")]
    internal static extern ulong GetTickCount64();

    internal static ulong ToUInt64(this System.Runtime.InteropServices.ComTypes.FILETIME fileTime) =>
        ((ulong)(uint)fileTime.dwHighDateTime << 32) | (uint)fileTime.dwLowDateTime;
}
