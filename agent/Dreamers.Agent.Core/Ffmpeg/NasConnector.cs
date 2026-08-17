using System.Runtime.InteropServices;
using Dreamers.Agent.Core.Credentials;

namespace Dreamers.Agent.Core.Ffmpeg;

public enum NasConnectCategory
{
    Success,
    NotConfigured,
    Authentication,
    Permission,
    Network,
}

public sealed record NasConnectResult(NasConnectCategory Category, int Win32Error, string Message)
{
    public bool Ok => Category is NasConnectCategory.Success;
}

/// <summary>
/// Establishes an authenticated SMB session to a UNC share
/// (\\host\share) using a dedicated credential (NasCredentialStore),
/// via the same Win32 API "net use" itself calls. Needed because the
/// Agent's Windows Service runs as LocalSystem, which has no
/// interactive-user SMB session and doesn't consult the logged-in
/// user's mapped drives or Credential Manager -- without this,
/// File.Exists()/ffmpeg.exe on a UNC path silently behave as if the
/// file doesn't exist at all (permission failure surfaces as "not
/// found", not "access denied").
///
/// Deliberately not "net use"-a-drive-letter -- CONNECT_TEMPORARY, no
/// lpLocalName -- this is a session/credential to the share, not a
/// mapped drive, so it works identically whether or not anyone is
/// interactively logged in, and doesn't collide with a real user's own
/// drive letters.
/// </summary>
public static class NasConnector
{
    private const int NoError = 0;
    private const int ErrorAlreadyAssigned = 85;
    private const int ErrorAccessDenied = 5;
    private const int ErrorBadNetName = 67;
    private const int ErrorBadNetPath = 53;
    private const int ErrorLogonFailure = 1326;
    private const int ErrorSessionCredentialConflict = 1219;
    private const int ResourceTypeDisk = 1;

    /// <summary>
    /// Per-job convenience: best-effort, no detail. Safe to call on every
    /// job for both sourcePath and outputPath -- connecting to an
    /// already-connected share is a fast no-op. If nothing is configured
    /// or the attempt fails, the caller's own File.Exists() check runs
    /// anyway and produces a clear error on its own; this only ever makes
    /// that check more likely to succeed.
    /// </summary>
    public static bool TryEnsureConnected(string uncPath, NasCredentialStore credentialStore)
    {
        var credential = credentialStore.Load();
        if (credential is null) return false;

        var shareRoot = ExtractShareRoot(uncPath);
        if (shareRoot is null) return false;

        return Connect(shareRoot, credential).Ok;
    }

    /// <summary>
    /// Startup-health-check convenience: same connection attempt, but
    /// with the Win32 result categorized (authentication/network/other)
    /// so NasHealthChecker can report a specific cause rather than a bare
    /// pass/fail.
    /// </summary>
    public static NasConnectResult EnsureConnectedDetailed(string shareRoot, NasCredential credential) =>
        Connect(shareRoot, credential);

    private static NasConnectResult Connect(string shareRoot, NasCredential credential)
    {
        // Always drop ANY existing session to this server first, not
        // just to the exact share -- observed in practice (diagnosed via
        // a clean `runas /netonly` test that connected fine with the
        // same credential): Windows tracks one identity per (session,
        // server), and something -- Explorer network browsing, another
        // LocalSystem-context connection, a leftover from an earlier
        // nas-credential attempt -- had already established an implicit
        // \\host\IPC$ session under a *different* identity, which then
        // made the explicit share connection fail with the confusing
        // ERROR_BAD_NET_NAME (67) instead of a clear conflict error.
        // Cancelling only the exact share (this class's original
        // behavior) didn't touch that IPC$-level session at all. All
        // best-effort/ignored: if nothing was connected, this is a
        // harmless no-op.
        var host = ExtractHost(shareRoot);
        if (host is not null)
        {
            WNetCancelConnection2($@"\\{host}\IPC$", dwFlags: 0, fForce: true);
            WNetCancelConnection2($@"\\{host}", dwFlags: 0, fForce: true);
        }
        WNetCancelConnection2(shareRoot, dwFlags: 0, fForce: true);

        var resource = new NetResource
        {
            dwType = ResourceTypeDisk,
            lpRemoteName = shareRoot,
            // Explicit, not null: with lpProvider unset, Windows
            // enumerates every installed network provider and can try a
            // wrong one first -- observed in practice on a machine with
            // the WebClient (WebDAV) service running (TrueNAS also
            // exposes a "WebDAV" share alongside the real SMB one),
            // which made a perfectly valid SMB credential/share fail
            // with ERROR_BAD_NET_NAME (67) before SMB itself was ever
            // tried. Naming the provider explicitly skips that
            // ambiguity entirely.
            lpProvider = "Microsoft Windows Network",
        };

        var result = WNetAddConnection2(ref resource, credential.Password, credential.Username, dwFlags: 0);

        if (result is NoError or ErrorAlreadyAssigned)
        {
            return new NasConnectResult(NasConnectCategory.Success, result, "Connected.");
        }

        return result switch
        {
            ErrorLogonFailure or ErrorAccessDenied or ErrorSessionCredentialConflict => new NasConnectResult(
                NasConnectCategory.Authentication, result,
                $"NAS rejected the configured credential for \"{shareRoot}\" (Win32 error {result})."),
            ErrorBadNetName or ErrorBadNetPath => new NasConnectResult(
                NasConnectCategory.Network, result,
                $"\"{shareRoot}\" is unreachable — host or share name not found (Win32 error {result})."),
            _ => new NasConnectResult(
                NasConnectCategory.Network, result,
                $"Could not connect to \"{shareRoot}\" (Win32 error {result})."),
        };
    }

    // "\\host\share\sub\dir\file.mov" -> "\\host\share". Null for
    // anything that isn't a UNC path (local drive letters don't need a
    // session).
    public static string? ExtractShareRoot(string uncPath)
    {
        if (!uncPath.StartsWith(@"\\", StringComparison.Ordinal)) return null;

        var parts = uncPath.Split('\\', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2) return null;

        return $@"\\{parts[0]}\{parts[1]}";
    }

    // "\\host\share" -> "host". Used to also clear \\host\IPC$ and
    // \\host (bare) sessions -- see Connect's comment above.
    private static string? ExtractHost(string shareRoot)
    {
        var parts = shareRoot.Split('\\', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length >= 1 ? parts[0] : null;
    }

    // CharSet.Unicode here is load-bearing, not decorative: without it,
    // this struct's string fields marshal as ANSI by default regardless
    // of the DllImport CharSet below (that only covers the function's
    // own direct string parameters -- lpPassword/lpUsername -- not a
    // struct parameter's internal fields). Since WNetAddConnection2
    // resolves to the *W (wide/UTF-16) entry point, it was reading
    // lpRemoteName/lpProvider as UTF-16 while they were actually written
    // as single-byte ANSI -- silently corrupting every string in this
    // struct into garbage, which is what was actually producing
    // ERROR_BAD_NET_NAME (67) on a share that demonstrably exists and is
    // reachable (confirmed via `net use` and a `test-nas`-vs-service A/B
    // test before finding this).
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NetResource
    {
        public int dwScope;
        public int dwType;
        public int dwDisplayType;
        public int dwUsage;
        public string? lpLocalName;
        public string lpRemoteName;
        public string? lpComment;
        public string? lpProvider;
    }

    [DllImport("mpr.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int WNetAddConnection2(ref NetResource lpNetResource, string lpPassword, string lpUsername, int dwFlags);

    [DllImport("mpr.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int WNetCancelConnection2(string lpName, int dwFlags, bool fForce);
}
