using System.Text.Json;

namespace Dreamers.Agent.Core.Configuration;

public sealed class TopazConfigStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
    };

    private readonly string _configPath;

    public TopazConfigStore(string dataDirectory)
    {
        Directory.CreateDirectory(dataDirectory);
        _configPath = Path.Combine(dataDirectory, "topaz_config.json");
    }

    public TopazConfig LoadOrCreate()
    {
        if (File.Exists(_configPath))
        {
            try
            {
                var json = File.ReadAllText(_configPath);
                var loaded = JsonSerializer.Deserialize<TopazConfig>(json, JsonOptions);
                if (loaded is not null)
                {
                    return loaded;
                }
            }
            catch (JsonException)
            {
                // Fall through and recreate with defaults rather than
                // crashing the agent over a hand-edit mistake.
            }
        }

        var config = new TopazConfig();
        Save(config);
        return config;
    }

    public void Save(TopazConfig config)
    {
        var json = JsonSerializer.Serialize(config, JsonOptions);
        var tempPath = _configPath + ".tmp";
        File.WriteAllText(tempPath, json);
        File.Move(tempPath, _configPath, overwrite: true);
    }
}
