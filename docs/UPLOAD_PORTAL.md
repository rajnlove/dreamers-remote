# Upload & Encode portal

Status: implemented and locally verified, **not deployed**. Public destination selected
by the owner: `https://vncgi.online/upload/`. Existing root site and Remote UI remain
in their existing services. The new process only serves `/upload/` and `/upload/api/*`.

## Processing and storage

```
Browser → Cloudflare → Upload portal → private NAS dataset
                           ↓ private authenticated Job Engine API
                     existing Render Queue → Windows Agents / NVENC
                                                   ↓
Browser ← authenticated result download ← output.mp4 on the same dataset
```

TrueNAS receives bounded byte streams and stores metadata. It does not execute
FFmpeg, ffprobe, Topaz, thumbnail creation or rendering. The upload image contains
no media tools. The existing agents perform decoding, scaling, GPU encoding and
audio processing; this can also use CPU on those workstations.

Each request carries at most **4 MiB**. The server checks SHA-256 for that chunk,
writes directly to the committed position in `source.part`, fsyncs, then commits
the SQLite offset. Completion renames that same file to `source.<extension>`;
there is no second complete copy or full-file merge/hash on TrueNAS. A restart
truncates uncommitted bytes on the next chunk. The browser reselects and verifies
the original file by a manifest of chunk hashes before resuming. Browser memory
usage is bounded by a chunk; identification reads the file on the user's computer.

The Job Engine now persists an account-scoped `Idempotency-Key` in the same SQLite
transaction as job creation. Lost replies and portal restarts replay the same key.
Deleting history leaves a key tombstone, preventing accidental recreation. Existing
clients that omit this optional header retain their existing behavior.

## Defaults and boundaries

| Setting | Default |
|---|---|
| Individual file | 20 GiB |
| Reserved upload quota | 100 GiB, reserving 3 × source size per record |
| Free-space reserve | 10 GiB |
| Incomplete sessions / stored records | 4 / 100 |
| Concurrent transfers, uploads and downloads combined | 2 |
| Abandoned incomplete upload retention | 48 hours since last committed chunk |
| Portal CPU / memory ceiling | 0.5 CPU / 512 MiB, swap disabled |
| Password / session | Minimum 16 characters / 24 hours |

Quota reservation is admission control, **not an output-size guarantee**: CQ output
may exceed twice the source size. Configure a dedicated TrueNAS dataset quota as
the hard storage ceiling, allowing normal working headroom. Keep the portal data
separate from production project files. Disk/SMB I/O and Cloudflare Tunnel consume
host resources outside the portal's CPU cgroup. Do not enable ZFS dedup for this
temporary media dataset. Incomplete files are cleaned two at a time; submitted
sources/results are retained until explicitly deleted after COMPLETED or FAILED.
Cancelled jobs require an operator to confirm the process has actually stopped
before manual cleanup. A pending backend retry does not delete its source.

The initial portal supports one studio-issued account configured through env.
People sharing this account share its files; it is not a multi-customer identity
system. It has no public registration. The portal uses separate persistent hashed
session tokens, HttpOnly/Secure/SameSite cookies, CSRF tokens, strict configured
Origin checks, CSP, private output routes and download disposition. Password
rotation invalidates existing sessions. Login attempts are globally limited to
10 per 15 minutes and one concurrent password verification; API requests and
connections are also bounded. Cloudflare Access can add individual staff access
before this account where needed. All content on the same public origin must be
trusted; path-scoped cookies are not a security boundary against another app's XSS.

Only six container extensions and fixed NVENC presets are accepted. Paths are
generated UUID children, never client-supplied UNC paths or command lines. Header
checks reject obvious non-media; they are not malware scanning or full validation.
Agents constrain recognized input formats to their expected demuxer, file-only
protocol and disabled MOV external references, including duration/dimension probes.
Keep worker FFmpeg patched and run agents under a restricted identity with only
the required share access. The backend and worker allow-lists remain mandatory.

## Configure the TrueNAS stack

Files: `docker/upload.Dockerfile`, `docker/upload-compose.yml`,
`docker/upload.env.example`. No new service has been started on TrueNAS.

1. The owner selected `V:\online` and supplied its network location. The dedicated
   child is `\\192.29.11.92\web_data\www\online\dreamers-upload`.
   On 2026-09-05, authenticated TrueNAS inspection confirmed web-online binds
   `/mnt/pool_cgivn_work/web_data/www/online` to `/app` read/write. The storage child
   is therefore `/mnt/pool_cgivn_work/web_data/www/online/dreamers-upload`.
   Container-shell stat confirmed UID/GID 3001:3001, mode 0770; `.htaccess` contains
   `Require all denied`. A harmless known file was successfully created as UID/GID
   3001:3001 with supplementary groups cleared. Requests for that exact file
   returned 403 at both LAN `:8088/online/dreamers-upload/` and public
   `https://vncgi.online/dreamers-upload/`; public `/online/dreamers-upload/` returned
   404. None exposed its content. The canary was removed after verification.
   Preserve this denial rule. Repeat the known-file check after web-server or
   routing changes, and refuse production use if any alias exposes the file.
   Keep SQLite state outside `www`; downloads go through the portal's authenticated
   output API. The verified host path and worker UNC are set in the env example.
2. Private SQLite state uses the local Docker volume `dreamers-upload-state`,
   initialized from image `/data` owned by 3001:3001 with mode 0700. Do not mount
   the backend database or store SQLite over an SMB/NFS client mount. A custom
   UID/GID requires matching volume ownership before starting the service.
   Back up portal state and media together when jobs are paused/drained.
3. Portal UID/GID 3001:3001 is now verified for this directory. Set inherited SMB ACLs so the portal UID can create files,
   the worker identity can read sources and create results, and the portal can read
   results. The portal uses umask 0007, directories 0770 and sources 0660. Match
   the shared group/ACL on both sides; do not grant Everyone write access. State
   should be readable only by the portal identity/operator. Test this mapping with
   a small file before admitting production uploads.
4. Fill a private copy of `upload.env.example` outside git with a strong portal
   password and a **separate non-admin backend account** seeded with
   `UPLOAD_SERVICE_USERNAME`/`UPLOAD_SERVICE_PASSWORD` on the backend (minimum
   32 random characters). Set the matching `UPLOAD_ENGINE_*` values on the portal.
   Existing PHP credentials are preserved. Do not put backend credentials into
   browser code or Cloudflare URLs. Existing usernames are not overwritten by seeding.
5. Permit the generated source/output directory in server `FFMPEG_ALLOWED_ROOTS`
   and each of the four agents' `allowed_paths.json`. Test the Windows service
   identity's NAS access. Portal failures return generic messages; administrators
   continue to inspect actual encode errors in the existing Render Queue.
6. Deploy the **backend idempotency patch and agent media-input restrictions first**.
   Updated agents advertise `upload_input_safety: "1"`; portal jobs require that
   exact software marker, so old workers cannot receive them. Update all four
   agents for full farm capacity. Build/publish the portal image through
   GitHub Actions, then pin `UPLOAD_IMAGE_TAG` to that tested commit SHA.
7. Create the new Dockge stack from the upload compose file with the private env
   values. Only the portal process receives the dataset. No Docker socket, host
   network, privileged mode or administrator API routes are exposed.

For Compose CLI, from a checkout on the host:

```sh
docker compose --env-file /path/to/private/upload.env -f docker/upload-compose.yml config --quiet
docker compose --env-file /path/to/private/upload.env -f docker/upload-compose.yml pull
docker compose --env-file /path/to/private/upload.env -f docker/upload-compose.yml up -d
```

Avoid printing resolved Compose config: it contains credentials. Docker is not
installed on this development machine, so the image and resolved stack still need
their first Linux build/start verification before production routing.

## Cloudflare routing

Add a specific path rule **before** the existing `vncgi.online` catch-all. Preserve
the full `/upload` prefix; route both static assets and API to the portal. If
cloudflared runs as a container, attach it to `dreamers-upload` in its own Compose
configuration (external network) and target `http://vncgi-upload:8090`. If it runs
directly on the host, use `http://127.0.0.1:18090` instead (or the chosen
`UPLOAD_HOST_PORT`). Host 8090 is already occupied by PHP Web; container port 8090
remains unchanged. Verify the chosen host port is free when starting the new stack.
Do not change the existing
root route or forward the LAN backend port 8080 to the public internet.

Example fragment for a locally managed tunnel (merge with existing rules):

```yaml
ingress:
  - hostname: vncgi.online
    path: ^/upload(/.*)?$
    service: http://vncgi-upload:8090
  # Existing vncgi.online route and existing final fallback follow here.
```

For remotely managed tunnels, configure the equivalent hostname/path/service in
the dashboard. Bypass caching for `/upload/api/*` and `/upload/`; serve API cookie
responses without caching. Keep HTTPS at the public edge and the origin restricted
to the private tunnel. Ensure any zone-specific request-size rule allows 4 MiB.
Cloudflare documents chunking as a response to large-request 413 errors:
[Cloudflare 413 guidance](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413/).

## Verification and rollout

Local validation performed:

- TypeScript server build and separate React upload production build passed.
- Three Node tests cover authenticated real HTTP streaming, checksum rejection,
  duplicate chunks, interrupted chunk rollback, simultaneous-request limits,
  persistent sessions/offsets after restart, cross-owner and CSRF denial, private
  result downloads including ranges, quota, cleanup and atomic job idempotency.
- 29 targeted agent argument/security tests passed. The full agent run had 122
  passes and one existing hardware-memory metric assertion failure in this Windows
  sandbox (`MetricsCollectorTests.Collect_ReturnsMemoryWithinSaneBounds`).
- Login and the complete empty-state portal were inspected in the in-app browser
  against the real local portal process. The preview has no production engine.

Before public routing: run one small real video through the updated agents, verify
source/output permissions, download it, interrupt/resume a multi-chunk upload,
check no duplicate job appears, confirm CPU/memory limits via Docker stats, and
check unauthenticated API/output requests are denied through Cloudflare. Test on
the actual hostname because its Origin/cookie behavior is deliberately strict.
No real NAS encode or Cloudflare end-to-end test has been claimed yet.

Rollback: restore the previous public path rule, stop only `vncgi-upload`, and keep
its state/media while existing jobs drain. Never delete source folders used by a
worker or run global Docker prune. The optional backend idempotency table is
backward compatible and can remain. Document promotion to PRODUCTION and a host
container audit in `CONTAINERS.md` once rollout is verified.

FFmpeg security options used:
[protocol whitelist](https://ffmpeg.org/ffmpeg-protocols.html),
[MOV external references](https://ffmpeg.org/ffmpeg-formats.html#mov_002fmp4_002f3gp).
