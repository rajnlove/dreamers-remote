namespace Dreamers.Agent.Core.Configuration;

/// <summary>
/// Persisted to C:\ProgramData\DreamersRemote\allowed_paths.json.
/// Phase 4 (P4-2): UNC roots an FFmpeg job's sourcePath/outputPath must
/// fall under, checked by this Agent independently of the server's own
/// check (FFMPEG_ALLOWED_ROOTS env var, server/src/config/env.ts) —
/// defense in depth, not just a server-side gate. Empty by default (deny
/// everything) so a fresh install doesn't silently accept arbitrary
/// paths until an admin actually configures this. Editable by hand; the
/// agent only reads this, never writes to it after the initial default
/// file is created.
/// </summary>
public sealed class AllowedPathsConfig
{
    public List<string> AllowedRoots { get; set; } = new();
}
