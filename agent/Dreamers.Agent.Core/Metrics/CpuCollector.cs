namespace Dreamers.Agent.Core.Metrics;

/// <summary>
/// Stateful by design: overall CPU utilization is a delta between two
/// GetSystemTimes samples, so this collector must live for the agent's
/// whole lifetime (one instance, not re-created per tick) to have a
/// "previous sample" to diff against.
/// </summary>
public sealed class CpuCollector
{
    private readonly string _name;
    private readonly int _physicalCoreCount;
    private readonly int _logicalProcessorCount;

    private ulong _lastIdle;
    private ulong _lastKernel;
    private ulong _lastUser;
    private bool _hasPreviousSample;

    public CpuCollector()
    {
        _logicalProcessorCount = Environment.ProcessorCount;
        (_name, _physicalCoreCount) = CpuIdentity.Read(_logicalProcessorCount);
    }

    public CpuSnapshot Collect()
    {
        double? utilization = null;

        if (NativeMethods.GetSystemTimes(out var idle, out var kernel, out var user))
        {
            var idleTicks = idle.ToUInt64();
            var kernelTicks = kernel.ToUInt64();
            var userTicks = user.ToUInt64();

            if (_hasPreviousSample)
            {
                var idleDelta = idleTicks - _lastIdle;
                // GetSystemTimes documents kernelTime as INCLUDING idle
                // time, so total elapsed = kernelDelta + userDelta (not
                // + idleDelta again), and busy = total - idle.
                var totalDelta = (kernelTicks - _lastKernel) + (userTicks - _lastUser);

                if (totalDelta > 0)
                {
                    var busyDelta = totalDelta - idleDelta;
                    utilization = Math.Clamp(busyDelta * 100.0 / totalDelta, 0, 100);
                }
            }

            _lastIdle = idleTicks;
            _lastKernel = kernelTicks;
            _lastUser = userTicks;
            _hasPreviousSample = true;
        }

        return new CpuSnapshot
        {
            Name = _name,
            LogicalProcessorCount = _logicalProcessorCount,
            PhysicalCoreCount = _physicalCoreCount,
            UtilizationPercent = utilization,
        };
    }
}
