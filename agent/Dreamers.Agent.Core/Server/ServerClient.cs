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

    /// <summary>
    /// Returns whatever the server had for this workstation on this
    /// heartbeat: a pending command (P2-8) and/or a newly assigned job
    /// (P3-4) — either can be null. Both ride this same response rather
    /// than being pushed; the Agent has no inbound listener.
    /// </summary>
    public async Task<HeartbeatResult> SendHeartbeatAsync(
        string credential,
        SystemMetricsSnapshot snapshot,
        RunningJobStatus? runningJob,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/agent/heartbeat");
        request.Headers.Add("X-Agent-Id", _config.AgentId);
        request.Headers.Add("X-Agent-Credential", credential);
        var payload = HeartbeatPayload.FromSnapshot(snapshot) with
        {
            RunningJob = runningJob is { } rj ? new HeartbeatPayload.RunningJobPayload { Id = rj.Id, Progress = rj.Progress } : null,
        };
        request.Content = JsonContent.Create(payload, options: JsonOptions);

        using var response = await _httpClient.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Heartbeat failed ({(int)response.StatusCode}): {body}");
        }

        var result = JsonSerializer.Deserialize<HeartbeatResponse>(body, JsonOptions);
        var job = result?.Job is { } j ? new AssignedJob(j.Id, j.Type, j.Input) : null;
        return new HeartbeatResult(result?.Command, job, result?.CancelJobId);
    }

    public async Task SendCommandResultAsync(
        string credential, string command, bool ok, string? detail, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/agent/command-result");
        request.Headers.Add("X-Agent-Id", _config.AgentId);
        request.Headers.Add("X-Agent-Credential", credential);
        request.Content = JsonContent.Create(new CommandResultRequest { Command = command, Ok = ok, Detail = detail }, options: JsonOptions);

        using var response = await _httpClient.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException($"command-result failed ({(int)response.StatusCode}): {body}");
        }
    }

    public async Task SendJobResultAsync(
        string credential, int jobId, bool ok, string? error, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/agent/job-result");
        request.Headers.Add("X-Agent-Id", _config.AgentId);
        request.Headers.Add("X-Agent-Credential", credential);
        request.Content = JsonContent.Create(new JobResultRequest { JobId = jobId, Ok = ok, Error = error }, options: JsonOptions);

        using var response = await _httpClient.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException($"job-result failed ({(int)response.StatusCode}): {body}");
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

    private sealed class HeartbeatResponse
    {
        public bool Ok { get; init; }
        public string? Command { get; init; }
        public AssignedJobPayload? Job { get; init; }
        // P3-5: set when the job we reported as RunningJob was cancelled
        // server-side (POST /api/jobs/:id/cancel) while we were mid-run.
        public int? CancelJobId { get; init; }
    }

    private sealed class AssignedJobPayload
    {
        public int Id { get; init; }
        public string Type { get; init; } = string.Empty;
        public string? Input { get; init; }
    }

    private sealed class CommandResultRequest
    {
        public string Command { get; init; } = string.Empty;
        public bool Ok { get; init; }
        public string? Detail { get; init; }
    }

    private sealed class JobResultRequest
    {
        public int JobId { get; init; }
        public bool Ok { get; init; }
        public string? Error { get; init; }
    }
}

public sealed record RunningJobStatus(int Id, int Progress);

public sealed record AssignedJob(int Id, string Type, string? Input);

public sealed record HeartbeatResult(string? Command, AssignedJob? Job, int? CancelJobId);
