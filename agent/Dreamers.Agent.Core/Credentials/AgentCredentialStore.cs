using System.Security.Cryptography;
using System.Text;

namespace Dreamers.Agent.Core.Credentials;

/// <summary>
/// Stores the long-lived agent credential (issued by the server at
/// registration, see docs/SECURITY.md) encrypted at rest via Windows
/// DPAPI — never plaintext, never in the repo, never logged.
/// LocalMachine scope (not CurrentUser): the agent normally runs as
/// LocalSystem under the Windows Service, not a specific interactive
/// user, so a machine-scoped key is what can actually decrypt it back.
///
/// One credential per server. The Agent registers with each server
/// independently and each issues its own credential, so they cannot
/// share a file. The filename carries a hash of the server URL rather
/// than the URL itself — a URL is not a legal filename, and the hash
/// keeps the mapping stable across restarts without needing an index.
/// </summary>
public sealed class AgentCredentialStore
{
    private const string LegacyFileName = "credential.dat";

    private readonly string _filePath;

    /// <summary>
    /// Legacy single-server store, reading and writing credential.dat.
    /// Kept for the pre-multi-server layout and for
    /// <see cref="MigrateLegacy"/>.
    /// </summary>
    public AgentCredentialStore(string dataDirectory)
    {
        Directory.CreateDirectory(dataDirectory);
        _filePath = Path.Combine(dataDirectory, LegacyFileName);
    }

    /// <summary>Per-server store for <paramref name="serverUrl"/>.</summary>
    public AgentCredentialStore(string dataDirectory, string serverUrl)
    {
        Directory.CreateDirectory(dataDirectory);
        _filePath = Path.Combine(dataDirectory, FileNameFor(serverUrl));
    }

    public bool HasCredential => File.Exists(_filePath);

    public void Save(string credential)
    {
        var plainBytes = Encoding.UTF8.GetBytes(credential);
        var protectedBytes = ProtectedData.Protect(plainBytes, optionalEntropy: null, DataProtectionScope.LocalMachine);
        File.WriteAllBytes(_filePath, protectedBytes);
    }

    /// <summary>Null if never registered, or if the stored blob can't be decrypted (corrupted, or protected under a different machine identity) — either way, "not registered" is the safe fallback rather than throwing.</summary>
    public string? Load()
    {
        if (!File.Exists(_filePath))
        {
            return null;
        }

        try
        {
            var protectedBytes = File.ReadAllBytes(_filePath);
            var plainBytes = ProtectedData.Unprotect(protectedBytes, optionalEntropy: null, DataProtectionScope.LocalMachine);
            return Encoding.UTF8.GetString(plainBytes);
        }
        catch (CryptographicException)
        {
            return null;
        }
    }

    /// <summary>
    /// Filename for a server. The URL is normalized first so that
    /// "http://Host:8080/" and "http://host:8080" resolve to the same
    /// credential — otherwise a trailing slash typed into agent.json
    /// would silently look like an unregistered server and the machine
    /// would drop out of the farm for no visible reason.
    /// </summary>
    public static string FileNameFor(string serverUrl)
    {
        var normalized = (serverUrl ?? string.Empty).Trim().TrimEnd('/').ToLowerInvariant();
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(normalized));
        return $"credential-{Convert.ToHexString(hash)[..16].ToLowerInvariant()}.dat";
    }

    /// <summary>
    /// One-time move of the pre-multi-server credential.dat onto the
    /// per-server filename for <paramref name="serverUrl"/>. Without it,
    /// upgrading the Agent would leave four already-paired machines
    /// looking unregistered, each needing a fresh token by hand.
    ///
    /// Copies rather than renames: if the upgrade is rolled back, the old
    /// binary still finds the file it expects. Does nothing when the
    /// per-server file already exists, so it is safe to call on every
    /// start.
    /// </summary>
    public static bool MigrateLegacy(string dataDirectory, string serverUrl)
    {
        var legacyPath = Path.Combine(dataDirectory, LegacyFileName);
        var targetPath = Path.Combine(dataDirectory, FileNameFor(serverUrl));

        if (!File.Exists(legacyPath) || File.Exists(targetPath))
        {
            return false;
        }

        File.Copy(legacyPath, targetPath);
        return true;
    }
}
