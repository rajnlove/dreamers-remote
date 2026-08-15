using System.Reflection;

namespace Dreamers.Agent.Core.Metrics;

internal static class AgentVersionReader
{
    internal static string Read() =>
        Assembly.GetEntryAssembly()?.GetName().Version?.ToString() ?? "0.0.0";
}
