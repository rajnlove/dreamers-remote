namespace Dreamers.Agent.Core.Ffmpeg;

/// <summary>
/// P4-2: mirrors the server's isPathUnderAllowedRoot
/// (server/src/job/ffmpegValidation.ts) — same semantics, checked
/// independently on the Agent as defense in depth (a compromised or
/// buggy server-side check shouldn't be the only thing standing between
/// a job and an arbitrary filesystem path).
/// </summary>
public static class PathValidator
{
    public static bool IsUnderAllowedRoot(string path, IReadOnlyList<string> allowedRoots)
    {
        if (string.IsNullOrWhiteSpace(path) || path.Contains("..", StringComparison.Ordinal))
        {
            return false;
        }

        var normalized = Normalize(path);
        foreach (var root in allowedRoots)
        {
            var normalizedRoot = Normalize(root);
            if (normalized == normalizedRoot || normalized.StartsWith(normalizedRoot + "\\", StringComparison.Ordinal))
            {
                return true;
            }
        }
        return false;
    }

    private static string Normalize(string path) =>
        path.ToLowerInvariant().Replace('/', '\\').TrimEnd('\\');
}
