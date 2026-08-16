using System.Text.Json;

namespace Dreamers.Agent.Core.Configuration;

public sealed class AllowedPathsConfigStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
    };

    private readonly string _configPath;

    public AllowedPathsConfigStore(string dataDirectory)
    {
        Directory.CreateDirectory(dataDirectory);
        _configPath = Path.Combine(dataDirectory, "allowed_paths.json");
    }

    public AllowedPathsConfig LoadOrCreate()
    {
        if (File.Exists(_configPath))
        {
            try
            {
                var json = File.ReadAllText(_configPath);
                var loaded = JsonSerializer.Deserialize<AllowedPathsConfig>(json, JsonOptions);
                // Unlike MonitoredProcessesConfig, an empty AllowedRoots
                // list is a valid, intentional state (deny-all) here, not
                // a sign the file is broken — don't overwrite it with
                // defaults just because it's empty.
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

        var config = new AllowedPathsConfig();
        Save(config);
        return config;
    }

    public void Save(AllowedPathsConfig config)
    {
        var json = JsonSerializer.Serialize(config, JsonOptions);
        var tempPath = _configPath + ".tmp";
        File.WriteAllText(tempPath, json);
        File.Move(tempPath, _configPath, overwrite: true);
    }
}
