using System.Text.Json;

namespace Dreamers.Agent.Core.Configuration;

/// <summary>
/// Loads/creates/saves agent.json. The directory is injected (not
/// hardcoded to ProgramData) so tests can point it at a temp folder.
/// </summary>
public sealed class AgentConfigStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
    };

    private readonly string _configPath;

    public AgentConfigStore(string dataDirectory)
    {
        Directory.CreateDirectory(dataDirectory);
        _configPath = Path.Combine(dataDirectory, "agent.json");
    }

    public static string DefaultDataDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "DreamersRemote");

    /// <summary>
    /// Loads the existing config, or creates one with a freshly generated
    /// AgentId if none exists yet. If a config file exists but its AgentId
    /// is somehow missing/blank, only the AgentId is regenerated — every
    /// other field (Servers, UpdateIntervalSeconds, ...) is preserved.
    ///
    /// Also normalizes the server list: an agent.json from an older Agent
    /// has only the single ServerUrl field, which is migrated into a
    /// one-entry Servers list owning jobs — an existing install keeps
    /// behaving exactly as before after an upgrade.
    /// </summary>
    public AgentConfig LoadOrCreate()
    {
        AgentConfig config;
        var fileExisted = File.Exists(_configPath);

        if (fileExisted)
        {
            var json = File.ReadAllText(_configPath);
            config = JsonSerializer.Deserialize<AgentConfig>(json, JsonOptions) ?? new AgentConfig();
        }
        else
        {
            config = new AgentConfig();
        }

        var needsNewId = string.IsNullOrWhiteSpace(config.AgentId);
        if (needsNewId)
        {
            config.AgentId = Guid.NewGuid().ToString();
        }

        var changedServers = NormalizeServers(config);

        if (needsNewId || changedServers || !fileExisted)
        {
            Save(config);
        }

        return config;
    }

    /// <summary>
    /// Brings the server list into a state the rest of the Agent can rely
    /// on, and reports whether anything had to change (so the caller can
    /// persist it once rather than re-deriving on every start).
    ///
    /// Two rules:
    ///
    /// 1. An empty list is filled from the legacy ServerUrl and given
    ///    ownership. Without this an upgraded Agent would come up with no
    ///    servers at all and go silent.
    /// 2. At most one owner survives. The list is hand-editable and the
    ///    ownership rule is not enforceable at the JSON level, so two
    ///    owners is a config a human can write. Keeping the first is
    ///    arbitrary but deterministic; the alternative — trusting the file
    ///    — is the id-collision this design exists to prevent.
    /// </summary>
    private static bool NormalizeServers(AgentConfig config)
    {
        var changed = false;

        config.Servers.RemoveAll(s => string.IsNullOrWhiteSpace(s.Url));

        if (config.Servers.Count == 0 && !string.IsNullOrWhiteSpace(config.ServerUrl))
        {
            config.Servers.Add(new AgentServerConfig { Url = config.ServerUrl, JobOwner = true });
            changed = true;
        }

        var seenOwner = false;
        foreach (var server in config.Servers)
        {
            if (!server.JobOwner)
            {
                continue;
            }

            if (seenOwner)
            {
                server.JobOwner = false;
                changed = true;
            }

            seenOwner = true;
        }

        return changed;
    }

    public void Save(AgentConfig config)
    {
        var json = JsonSerializer.Serialize(config, JsonOptions);
        var tempPath = _configPath + ".tmp";
        File.WriteAllText(tempPath, json);
        File.Move(tempPath, _configPath, overwrite: true);
    }
}
