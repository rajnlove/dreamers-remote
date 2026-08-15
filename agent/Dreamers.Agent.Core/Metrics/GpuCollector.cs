using System.Text;

namespace Dreamers.Agent.Core.Metrics;

/// <summary>
/// NVIDIA-only (NVML). Supports multiple GPUs — VFX workstations
/// routinely have 2+. On a machine with no NVIDIA GPU (or no driver),
/// <see cref="Collect"/> returns an empty list rather than throwing —
/// see <see cref="NvmlNativeMethods"/> for why.
/// </summary>
public sealed class GpuCollector
{
    private bool _initAttempted;
    private bool _nvmlAvailable;

    public IReadOnlyList<GpuSnapshot> Collect()
    {
        EnsureInitialized();
        if (!_nvmlAvailable)
        {
            return Array.Empty<GpuSnapshot>();
        }

        if (NvmlNativeMethods.nvmlDeviceGetCount_v2(out var count) != NvmlReturn.Success)
        {
            return Array.Empty<GpuSnapshot>();
        }

        var gpus = new List<GpuSnapshot>((int)count);
        for (uint i = 0; i < count; i++)
        {
            var gpu = TryReadGpu(i);
            if (gpu is not null)
            {
                gpus.Add(gpu);
            }
        }

        return gpus;
    }

    private void EnsureInitialized()
    {
        if (_initAttempted)
        {
            return;
        }

        _initAttempted = true;

        try
        {
            _nvmlAvailable = NvmlNativeMethods.nvmlInit_v2() == NvmlReturn.Success;
        }
        catch (DllNotFoundException)
        {
            // No NVIDIA driver installed — expected on many workstations.
            _nvmlAvailable = false;
        }
        catch (EntryPointNotFoundException)
        {
            // Driver present but too old/new for the functions used here.
            _nvmlAvailable = false;
        }
    }

    private static GpuSnapshot? TryReadGpu(uint index)
    {
        if (NvmlNativeMethods.nvmlDeviceGetHandleByIndex_v2(index, out var handle) != NvmlReturn.Success)
        {
            return null;
        }

        var nameBuilder = new StringBuilder(96);
        NvmlNativeMethods.nvmlDeviceGetName(handle, nameBuilder, (uint)nameBuilder.Capacity);

        double utilization = 0;
        if (NvmlNativeMethods.nvmlDeviceGetUtilizationRates(handle, out var util) == NvmlReturn.Success)
        {
            utilization = util.Gpu;
        }

        long usedMb = 0;
        long totalMb = 0;
        double vramPercent = 0;
        if (NvmlNativeMethods.nvmlDeviceGetMemoryInfo(handle, out var mem) == NvmlReturn.Success)
        {
            usedMb = (long)(mem.Used / (1024 * 1024));
            totalMb = (long)(mem.Total / (1024 * 1024));
            vramPercent = totalMb > 0 ? Math.Round(usedMb * 100.0 / totalMb, 1) : 0;
        }

        int? temperature = null;
        if (NvmlNativeMethods.nvmlDeviceGetTemperature(handle, NvmlTemperatureSensor.Gpu, out var temp) == NvmlReturn.Success)
        {
            temperature = (int)temp;
        }

        return new GpuSnapshot
        {
            Index = (int)index,
            Name = nameBuilder.ToString(),
            UtilizationPercent = utilization,
            VramUsedMb = usedMb,
            VramTotalMb = totalMb,
            VramUsagePercent = vramPercent,
            TemperatureCelsius = temperature,
        };
    }
}
