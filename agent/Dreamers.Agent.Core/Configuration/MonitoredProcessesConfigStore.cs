using System.Text.Json;

namespace Dreamers.Agent.Core.Configuration;

public sealed class MonitoredProcessesConfigStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
    };

    private readonly string _configPath;

    public MonitoredProcessesConfigStore(string dataDirectory)
    {
        Directory.CreateDirectory(dataDirectory);
        _configPath = Path.Combine(dataDirectory, "monitored_processes.json");
    }

    public MonitoredProcessesConfig LoadOrCreate()
    {
        if (File.Exists(_configPath))
        {
            try
            {
                var json = File.ReadAllText(_configPath);
                var loaded = JsonSerializer.Deserialize<MonitoredProcessesConfig>(json, JsonOptions);
                if (loaded is not null && loaded.ProcessNames.Count > 0)
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

        var config = new MonitoredProcessesConfig();
        Save(config);
        return config;
    }

    public void Save(MonitoredProcessesConfig config)
    {
        var json = JsonSerializer.Serialize(config, JsonOptions);
        var tempPath = _configPath + ".tmp";
        File.WriteAllText(tempPath, json);
        File.Move(tempPath, _configPath, overwrite: true);
    }
}
