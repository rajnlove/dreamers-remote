using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Dreamers.Agent.Core.Credentials;

public sealed record NasCredential(string Username, string Password);

/// <summary>
/// Stores the dedicated SMB credential the Agent uses to reach NAS UNC
/// paths (e.g. \\192.29.11.92\web_data\...) before running an ffmpeg
/// job -- see NasConnector. Same DPAPI-at-rest pattern as
/// AgentCredentialStore and for the same reason: the service runs as
/// LocalSystem, which has no interactive-user SMB session of its own,
/// so File.Exists()/ffmpeg.exe on a UNC path silently behave as if the
/// file doesn't exist without this.
/// </summary>
public sealed class NasCredentialStore
{
    private readonly string _filePath;

    public NasCredentialStore(string dataDirectory)
    {
        Directory.CreateDirectory(dataDirectory);
        _filePath = Path.Combine(dataDirectory, "nas-credential.dat");
    }

    public bool HasCredential => File.Exists(_filePath);

    public void Save(NasCredential credential)
    {
        var plainBytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(credential));
        var protectedBytes = ProtectedData.Protect(plainBytes, optionalEntropy: null, DataProtectionScope.LocalMachine);
        File.WriteAllBytes(_filePath, protectedBytes);
    }

    /// <summary>Null if never configured, or if the stored blob can't be decrypted (corrupted, or protected under a different machine identity) -- either way, "no credential" is the safe fallback rather than throwing.</summary>
    public NasCredential? Load()
    {
        if (!File.Exists(_filePath))
        {
            return null;
        }

        try
        {
            var protectedBytes = File.ReadAllBytes(_filePath);
            var plainBytes = ProtectedData.Unprotect(protectedBytes, optionalEntropy: null, DataProtectionScope.LocalMachine);
            return JsonSerializer.Deserialize<NasCredential>(Encoding.UTF8.GetString(plainBytes));
        }
        catch (Exception ex) when (ex is CryptographicException or JsonException)
        {
            return null;
        }
    }
}
