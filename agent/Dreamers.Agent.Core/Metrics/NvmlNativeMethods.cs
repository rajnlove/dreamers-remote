using System.Runtime.InteropServices;
using System.Text;

namespace Dreamers.Agent.Core.Metrics;

internal enum NvmlReturn
{
    Success = 0,
    // Every other NVML_ERROR_* value just means "this call failed" for our
    // purposes — GpuCollector only checks for Success, so the rest aren't
    // enumerated.
}

internal enum NvmlTemperatureSensor
{
    Gpu = 0,
}

[StructLayout(LayoutKind.Sequential)]
internal struct NvmlUtilization
{
    public uint Gpu;
    public uint Memory;
}

[StructLayout(LayoutKind.Sequential)]
internal struct NvmlMemory
{
    public ulong Total;
    public ulong Free;
    public ulong Used;
}

/// <summary>
/// P/Invoke bindings for the small slice of NVML actually used here.
/// nvml.dll ships with the NVIDIA driver (System32 or
/// "NVIDIA Corporation\NVSMI", both on the standard DLL search path once
/// the driver is installed) — on a machine with no NVIDIA GPU, the DLL
/// simply isn't there, and every P/Invoke call throws
/// <see cref="DllNotFoundException"/>. GpuCollector treats that as
/// "no GPUs to report", not an agent-wide failure.
/// </summary>
internal static class NvmlNativeMethods
{
    private const string NvmlDll = "nvml.dll";

    [DllImport(NvmlDll)]
    internal static extern NvmlReturn nvmlInit_v2();

    [DllImport(NvmlDll)]
    internal static extern NvmlReturn nvmlShutdown();

    [DllImport(NvmlDll)]
    internal static extern NvmlReturn nvmlDeviceGetCount_v2(out uint deviceCount);

    [DllImport(NvmlDll)]
    internal static extern NvmlReturn nvmlDeviceGetHandleByIndex_v2(uint index, out IntPtr device);

    [DllImport(NvmlDll, CharSet = CharSet.Ansi)]
    internal static extern NvmlReturn nvmlDeviceGetName(IntPtr device, StringBuilder name, uint length);

    [DllImport(NvmlDll)]
    internal static extern NvmlReturn nvmlDeviceGetUtilizationRates(IntPtr device, out NvmlUtilization utilization);

    [DllImport(NvmlDll)]
    internal static extern NvmlReturn nvmlDeviceGetMemoryInfo(IntPtr device, out NvmlMemory memory);

    [DllImport(NvmlDll)]
    internal static extern NvmlReturn nvmlDeviceGetTemperature(IntPtr device, NvmlTemperatureSensor sensorType, out uint temp);
}
