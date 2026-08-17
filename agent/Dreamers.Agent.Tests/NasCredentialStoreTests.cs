using Dreamers.Agent.Core.Credentials;
using Xunit;

namespace Dreamers.Agent.Tests;

public class NasCredentialStoreTests
{
    private static string CreateTempDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), "DreamersNasCredentialTests_" + Guid.NewGuid());
        Directory.CreateDirectory(path);
        return path;
    }

    [Fact]
    public void HasCredential_IsFalse_BeforeAnythingIsSaved()
    {
        var dir = CreateTempDirectory();
        try
        {
            var store = new NasCredentialStore(dir);

            Assert.False(store.HasCredential);
            Assert.Null(store.Load());
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void Save_ThenLoad_RoundTripsUsernameAndPassword()
    {
        var dir = CreateTempDirectory();
        try
        {
            var store = new NasCredentialStore(dir);
            var credential = new NasCredential("dreamers-agent", "s3cr3t-nas-p@ss");

            store.Save(credential);

            Assert.True(store.HasCredential);
            var loaded = store.Load();
            Assert.NotNull(loaded);
            Assert.Equal(credential.Username, loaded!.Username);
            Assert.Equal(credential.Password, loaded.Password);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void Save_EncryptsAtRest_FileDoesNotContainThePlaintextPassword()
    {
        var dir = CreateTempDirectory();
        try
        {
            var store = new NasCredentialStore(dir);
            var credential = new NasCredential("dreamers-agent", "s3cr3t-nas-p@ss");

            store.Save(credential);

            var rawFileContent = File.ReadAllText(Path.Combine(dir, "nas-credential.dat"));
            Assert.DoesNotContain(credential.Password, rawFileContent);
            Assert.DoesNotContain(credential.Username, rawFileContent);
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
            File.WriteAllBytes(Path.Combine(dir, "nas-credential.dat"), new byte[] { 1, 2, 3, 4, 5 });
            var store = new NasCredentialStore(dir);

            Assert.Null(store.Load());
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }
}
