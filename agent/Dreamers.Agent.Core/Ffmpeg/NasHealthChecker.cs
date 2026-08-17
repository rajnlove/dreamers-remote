using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Credentials;

namespace Dreamers.Agent.Core.Ffmpeg;

public sealed record NasHealthResult(NasConnectCategory Category, string Message)
{
    public bool Ok => Category is NasConnectCategory.Success;
}

/// <summary>
/// Startup gate for the "ffmpeg" capability (see WorkerCapabilities):
/// authenticates to the first configured allowed root using the
/// dedicated NAS credential, then proves both read and write actually
/// work by listing the directory and round-tripping a small probe file
/// -- a successful auth alone doesn't guarantee the account has the
/// right share/NTFS permissions for the job engine's real workload
/// (reading sourcePath, writing outputPath next to it).
///
/// Run once at Agent startup (Lazy, see WorkerCapabilities) rather than
/// per-job: this is deliberately more thorough (and slower — a real
/// file round-trip) than NasConnector.TryEnsureConnected's per-job
/// best-effort reconnect, so jobs aren't gated on a full read/write
/// probe every 5s heartbeat.
/// </summary>
public static class NasHealthChecker
{
    public static NasHealthResult Check(NasCredentialStore credentialStore, AllowedPathsConfigStore allowedPathsStore)
    {
        var roots = allowedPathsStore.LoadOrCreate().AllowedRoots;
        if (roots.Count == 0)
        {
            return new NasHealthResult(NasConnectCategory.NotConfigured, "No allowed roots configured (allowed_paths.json) — ffmpeg jobs are disabled on this Agent.");
        }

        var credential = credentialStore.Load();
        if (credential is null)
        {
            return new NasHealthResult(
                NasConnectCategory.Authentication,
                "No NAS credential configured — run \"DreamersAgent.exe nas-credential <username>\" on this machine, then restart the service.");
        }

        var root = roots[0];
        var shareRoot = NasConnector.ExtractShareRoot(root);
        if (shareRoot is null)
        {
            return new NasHealthResult(NasConnectCategory.NotConfigured, $"Allowed root \"{root}\" is not a UNC path — nothing to authenticate to.");
        }

        var connectResult = NasConnector.EnsureConnectedDetailed(shareRoot, credential);
        if (!connectResult.Ok)
        {
            return new NasHealthResult(connectResult.Category, connectResult.Message);
        }

        try
        {
            // Read check: prove the account can actually list this
            // directory, not just complete the SMB handshake.
            Directory.GetFileSystemEntries(root);
        }
        catch (UnauthorizedAccessException)
        {
            return new NasHealthResult(NasConnectCategory.Permission, $"Connected to \"{shareRoot}\" but the account cannot read \"{root}\" (access denied).");
        }
        catch (Exception ex)
        {
            return new NasHealthResult(NasConnectCategory.Network, $"Connected to \"{shareRoot}\" but listing \"{root}\" failed: {ex.Message}");
        }

        var probePath = Path.Combine(root, $".dreamers-agent-probe-{Guid.NewGuid():N}.tmp");
        try
        {
            File.WriteAllBytes(probePath, new byte[] { 1 });
            File.Delete(probePath);
        }
        catch (UnauthorizedAccessException)
        {
            return new NasHealthResult(NasConnectCategory.Permission, $"Connected to \"{shareRoot}\" and can read \"{root}\", but cannot write there (access denied) — ffmpeg jobs need to write their output under an allowed root.");
        }
        catch (Exception ex)
        {
            return new NasHealthResult(NasConnectCategory.Network, $"Connected to \"{shareRoot}\" but the write probe to \"{root}\" failed: {ex.Message}");
        }

        return new NasHealthResult(NasConnectCategory.Success, $"Authenticated to \"{shareRoot}\" and verified read/write access to \"{root}\".");
    }
}
