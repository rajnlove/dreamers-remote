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
/// </summary>
public sealed class AgentCredentialStore
{
    private readonly string _filePath;

    public AgentCredentialStore(string dataDirectory)
    {
        Directory.CreateDirectory(dataDirectory);
        _filePath = Path.Combine(dataDirectory, "credential.dat");
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
}
