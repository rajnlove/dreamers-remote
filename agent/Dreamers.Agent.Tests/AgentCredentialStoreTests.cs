using Dreamers.Agent.Core.Credentials;
using Xunit;

namespace Dreamers.Agent.Tests;

public class AgentCredentialStoreTests
{
    private static string CreateTempDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), "DreamersAgentCredentialTests_" + Guid.NewGuid());
        Directory.CreateDirectory(path);
        return path;
    }

    [Fact]
    public void HasCredential_IsFalse_BeforeAnythingIsSaved()
    {
        var dir = CreateTempDirectory();
        try
        {
            var store = new AgentCredentialStore(dir);

            Assert.False(store.HasCredential);
            Assert.Null(store.Load());
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void Save_ThenLoad_RoundTripsTheCredential()
    {
        var dir = CreateTempDirectory();
        try
        {
            var store = new AgentCredentialStore(dir);
            const string credential = "super-secret-agent-credential";

            store.Save(credential);

            Assert.True(store.HasCredential);
            Assert.Equal(credential, store.Load());
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void Save_EncryptsAtRest_FileDoesNotContainThePlaintextCredential()
    {
        var dir = CreateTempDirectory();
        try
        {
            var store = new AgentCredentialStore(dir);
            const string credential = "super-secret-agent-credential";

            store.Save(credential);

            var rawFileContent = File.ReadAllText(Path.Combine(dir, "credential.dat"));
            Assert.DoesNotContain(credential, rawFileContent);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void Load_ReturnsNull_ForACorruptedFile()
    {
        var dir = CreateTempDirectory();
        try
        {
            File.WriteAllBytes(Path.Combine(dir, "credential.dat"), new byte[] { 1, 2, 3, 4, 5 });
            var store = new AgentCredentialStore(dir);

            Assert.Null(store.Load());
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }
}
