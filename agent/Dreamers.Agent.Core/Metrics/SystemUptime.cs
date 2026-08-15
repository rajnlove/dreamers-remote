namespace Dreamers.Agent.Core.Metrics;

internal static class SystemUptime
{
    internal static TimeSpan Read() => TimeSpan.FromMilliseconds(NativeMethods.GetTickCount64());
}
