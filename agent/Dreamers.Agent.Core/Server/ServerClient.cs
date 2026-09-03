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
    /// heartbeat: a pending command (P2-8) and/or newly assigned jobs
    /// (P3-4/P4-3H) — either can be empty. Both ride this same response
    /// rather than being pushed; the Agent has no inbound listener.
    /// </summary>
    public async Task<HeartbeatResult> SendHeartbeatAsync(
        string credential,
        SystemMetricsSnapshot snapshot,
        IReadOnlyList<RunningJobStatus> runningJobs,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/agent/heartbeat");
        request.Headers.Add("X-Agent-Id", _config.AgentId);
        request.Headers.Add("X-Agent-Credential", credential);
        var runningPayloads = runningJobs
            .Select(rj => new HeartbeatPayload.RunningJobPayload { Id = rj.Id, Progress = rj.Progress, Fps = rj.Fps, EtaSeconds = rj.EtaSeconds })
            .ToList();
        var payload = HeartbeatPayload.FromSnapshot(snapshot) with
        {
            RunningJobs = runningPayloads,
            // Legacy singular field for a server that hasn't been
            // redeployed with P4-3H's multi-job support yet.
            RunningJob = runningPayloads.Count > 0 ? runningPayloads[0] : null,
        };
        request.Content = JsonContent.Create(payload, options: JsonOptions);

        using var response = await _httpClient.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Heartbeat failed ({(int)response.StatusCode}): {body}");
        }

        var result = JsonSerializer.Deserialize<HeartbeatResponse>(body, JsonOptions);

        // P4-3H: prefer the plural fields; fall back to the legacy
        // singular ones for a server that hasn't been redeployed yet, so
        // this Agent binary still works against either era of server.
        IReadOnlyList<AssignedJob> jobs = result?.Jobs is { Count: > 0 } js
            ? js.Select(j => new AssignedJob(j.Id, j.Type, j.Input, j.GpuSlot)).ToList()
            : result?.Job is { } single
                ? new[] { new AssignedJob(single.Id, single.Type, single.Input, single.GpuSlot) }
                : Array.Empty<AssignedJob>();

        IReadOnlyList<int> cancelJobIds = result?.CancelJobIds is { Count: > 0 } cids
            ? cids
            : result?.CancelJobId is { } singleCancel
                ? new[] { singleCancel }
                : Array.Empty<int>();

        return new HeartbeatResult(result?.Command, jobs, cancelJobIds);
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
        string credential, int jobId, bool ok, string? output, string? error, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/agent/job-result");
        request.Headers.Add("X-Agent-Id", _config.AgentId);
        request.Headers.Add("X-Agent-Credential", credential);
        request.Content = JsonContent.Create(new JobResultRequest { JobId = jobId, Ok = ok, Output = output, Error = error }, options: JsonOptions);

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
        // Legacy singular fields -- still populated by the server
        // (jobs[0]/cancelJobIds[0]) for an Agent binary that hasn't been
        // redeployed with P4-3H's multi-job support yet.
        public AssignedJobPayload? Job { get; init; }
        public int? CancelJobId { get; init; }
        // P4-3H: every newly assigned job / every job the server wants
        // stopped, one entry per GPU slot instead of at most one overall.
        public IReadOnlyList<AssignedJobPayload>? Jobs { get; init; }
        public IReadOnlyList<int>? CancelJobIds { get; init; }
    }

    private sealed class AssignedJobPayload
    {
        public int Id { get; init; }
        public string Type { get; init; } = string.Empty;
        public string? Input { get; init; }
        // P4-5 prep: the GPU index the scheduler reserved this job's
        // unit on (server/src/api/agent.ts's heartbeat route, mirroring
        // the DB's jobs.gpu_slot column) -- null for a CPU-only unit.
        public int? GpuSlot { get; init; }
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
        // Free-form JSON string a runner attached to a successful result
        // (see JobSnapshot.Output's doc comment) -- e.g. FfmpegJobRunner's
        // {sourceWidth, sourceHeight, thumbnailPath}. Server stores this
        // as-is in jobs.output, no server-side interpretation needed.
        public string? Output { get; init; }
        public string? Error { get; init; }
    }
}

public sealed record RunningJobStatus(int Id, int Progress, double? Fps = null, int? EtaSeconds = null);

public sealed record AssignedJob(int Id, string Type, string? Input, int? GpuSlot = null);

// P4-3H: Jobs/CancelJobIds are lists now -- a worker with N free GPU
// slots can have up to N newly-assigned jobs (or N jobs to cancel) in a
// single heartbeat response, not just one. See IJobRunner's doc comment.
public sealed record HeartbeatResult(string? Command, IReadOnlyList<AssignedJob> Jobs, IReadOnlyList<int> CancelJobIds);
