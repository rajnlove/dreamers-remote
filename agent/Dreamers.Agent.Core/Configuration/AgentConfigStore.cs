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
    /// other field (ServerUrl, UpdateIntervalSeconds, ...) is preserved.
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

        if (needsNewId || !fileExisted)
        {
            Save(config);
        }

        return config;
    }

    public void Save(AgentConfig config)
    {
        var json = JsonSerializer.Serialize(config, JsonOptions);
        var tempPath = _configPath + ".tmp";
        File.WriteAllText(tempPath, json);
        File.Move(tempPath, _configPath, overwrite: true);
    }
}
