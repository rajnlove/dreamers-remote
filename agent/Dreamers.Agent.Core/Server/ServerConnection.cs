using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Credentials;

namespace Dreamers.Agent.Core.Server;

/// <summary>
/// One configured server plus everything needed to talk to it: its own
/// HTTP client and its own credential. Bundled because the three must
/// not be mixed up — sending Dreamers Remote's credential to Dreamers
/// Encoder authenticates as nobody, and the failure would look like an
/// unregistered machine rather than a wiring mistake.
/// </summary>
public sealed class ServerConnection
{
    public ServerConnection(AgentServerConfig config, ServerClient client, AgentCredentialStore credentialStore)
    {
        Config = config;
        Client = client;
        CredentialStore = credentialStore;
        Credential = credentialStore.Load();
    }

    public AgentServerConfig Config { get; }

    public ServerClient Client { get; }

    public AgentCredentialStore CredentialStore { get; }

    /// <summary>
    /// Null until this Agent has been paired with this particular server.
    /// A machine can legitimately be registered with one server and not
    /// the other — during a rollout that is the normal intermediate state.
    /// </summary>
    public string? Credential { get; private set; }

    public string Url => Config.Url;

    /// <summary>Whether this server may assign jobs. See <see cref="AgentServerConfig"/>.</summary>
    public bool JobOwner => Config.JobOwner;

    /// <summary>Re-reads the credential from disk, e.g. after registering.</summary>
    public void ReloadCredential() => Credential = CredentialStore.Load();
}
