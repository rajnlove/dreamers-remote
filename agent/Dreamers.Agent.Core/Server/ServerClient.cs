using System.Net.Http.Json;
using System.Text.Json;
using Dreamers.Agent.Core.Configuration;
using Dreamers.Agent.Core.Metrics;

namespace Dreamers.Agent.Core.Server;

/// <summary>
/// Talks to the Dreamers Remote server's /api/agent/* routes. Every call
/// here can fail (server down, network blip, DNS) — callers (Worker.cs)
/// are responsible for catching and logging, never letting a failed
/// heartbeat take the agent down. See docs/PROJECT_STATUS.md Phase 2
/// resilience notes.
/// </summary>
public sealed class ServerClient
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private readonly HttpClient _httpClient;
    private readonly AgentConfig _config;

    public ServerClient(HttpClient httpClient, AgentConfig config)
    {
        _httpClient = httpClient;
        _config = config;
        _httpClient.BaseAddress = new Uri(config.ServerUrl);
        _httpClient.Timeout = TimeSpan.FromSeconds(10);
    }

    public async Task<string> RegisterAsync(string registrationToken, CancellationToken cancellationToken = default)
    {
        var payload = new RegisterRequest
        {
            RegistrationToken = registrationToken,
            AgentId = _config.AgentId,
            Os = Environment.OSVersion.VersionString,
            AgentVersion = AgentVersionReader.Read(),
        };

        using var response = await _httpClient.PostAsJsonAsync("/api/agent/register", payload, JsonOptions, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Registration failed ({(int)response.StatusCode}): {body}");
        }

        var result = JsonSerializer.Deserialize<RegisterResponse>(body, JsonOptions);
        if (result is null || string.IsNullOrEmpty(result.AgentCredential))
        {
            throw new InvalidOperationException("Server did not return an agent credential");
        }

        return result.AgentCredential;
    }

    public async Task SendHeartbeatAsync(string credential, SystemMetricsSnapshot snapshot, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/agent/heartbeat");
        request.Headers.Add("X-Agent-Id", _config.AgentId);
        request.Headers.Add("X-Agent-Credential", credential);
        request.Content = JsonContent.Create(HeartbeatPayload.FromSnapshot(snapshot), options: JsonOptions);

        using var response = await _httpClient.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException($"Heartbeat failed ({(int)response.StatusCode}): {body}");
        }
    }

    private sealed class RegisterRequest
    {
        public string RegistrationToken { get; init; } = string.Empty;
        public string AgentId { get; init; } = string.Empty;
        public string? Os { get; init; }
        public string? AgentVersion { get; init; }
    }

    private sealed class RegisterResponse
    {
        public int WorkstationId { get; init; }
        public string? WorkstationName { get; init; }
        public string AgentCredential { get; init; } = string.Empty;
    }
}
