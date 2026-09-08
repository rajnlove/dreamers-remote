using System.Runtime.InteropServices;
using Dreamers.Agent.Core.Configuration;

namespace Dreamers.Agent.Core.Metrics;

/// <summary>
/// Free space on each configured allow-listed root.
///
/// Not DriveInfo: that only understands local drives and mapped letters,
/// and these roots are UNC paths on a NAS. GetDiskFreeSpaceEx takes a
/// UNC directory directly and reports the quota that applies to the
/// calling identity, which is the number that actually matters — the
/// Agent runs as LocalSystem and writes as the NAS service account.
/// </summary>
public sealed class NasSpaceCollector
{
    private readonly AllowedPathsConfigStore _allowedPathsStore;

    public NasSpaceCollector(AllowedPathsConfigStore allowedPathsStore)
    {
        _allowedPathsStore = allowedPathsStore;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetDiskFreeSpaceEx(
        string lpDirectoryName,
        out ulong lpFreeBytesAvailableToCaller,
        out ulong lpTotalNumberOfBytes,
        out ulong lpTotalNumberOfFreeBytes);

    public IReadOnlyList<NasSpaceSnapshot> Collect()
    {
        var results = new List<NasSpaceSnapshot>();

        List<string> roots;
        try
        {
            roots = _allowedPathsStore.LoadOrCreate().AllowedRoots;
        }
        catch (Exception)
        {
            // Reporting no NAS space is the honest answer when the config
            // can't be read; inventing a number would make the low-space
            // alert lie in the safe direction, which is the worse lie.
            return results;
        }

        // Several roots usually live on the same share, and asking twice
        // costs a network round trip on every heartbeat.
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var root in roots)
        {
            if (string.IsNullOrWhiteSpace(root) || !seen.Add(root.TrimEnd('\\')))
            {
                continue;
            }

            try
            {
                if (!GetDiskFreeSpaceEx(root, out _, out var totalBytes, out var totalFreeBytes) || totalBytes == 0)
                {
                    // Unreachable share, no permission, or a path that no
                    // longer exists. NasHealthChecker already reports the
                    // reason on its own; silently skipping here keeps one
                    // broken root from hiding the others.
                    continue;
                }

                var totalMb = (long)(totalBytes / (1024 * 1024));
                var freeMb = (long)(totalFreeBytes / (1024 * 1024));

                results.Add(new NasSpaceSnapshot
                {
                    Root = root,
                    TotalMb = totalMb,
                    FreeMb = freeMb,
                    FreePercent = totalMb > 0 ? Math.Round(freeMb * 100.0 / totalMb, 1) : 0,
                });
            }
            catch (Exception)
            {
                // Same reasoning as above: one bad root must not take the
                // whole heartbeat down.
            }
        }

        return results;
    }
}
