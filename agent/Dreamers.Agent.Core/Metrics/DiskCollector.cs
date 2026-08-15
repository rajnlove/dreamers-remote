namespace Dreamers.Agent.Core.Metrics;

/// <summary>
/// Local fixed drives only (DriveType.Fixed) — no NAS shares (out of
/// scope for Phase 2, see ROADMAP.md), no directory scanning.
/// </summary>
public sealed class DiskCollector
{
    public IReadOnlyList<DiskSnapshot> Collect()
    {
        var disks = new List<DiskSnapshot>();

        foreach (var drive in DriveInfo.GetDrives())
        {
            if (drive.DriveType != DriveType.Fixed || !drive.IsReady)
            {
                continue;
            }

            try
            {
                var totalMb = drive.TotalSize / (1024 * 1024);
                var freeMb = drive.TotalFreeSpace / (1024 * 1024);
                var usedMb = totalMb - freeMb;

                disks.Add(new DiskSnapshot
                {
                    Name = drive.Name,
                    TotalMb = totalMb,
                    UsedMb = usedMb,
                    FreeMb = freeMb,
                    UsagePercent = totalMb > 0 ? Math.Round(usedMb * 100.0 / totalMb, 1) : 0,
                });
            }
            catch (IOException)
            {
                // A single inaccessible/misbehaving drive must not stop
                // the others from being reported.
            }
        }

        return disks;
    }
}
