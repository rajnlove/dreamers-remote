# Upload & Encode portal

Status (2026-09-05): **deployed; H.264 encode/download verified on all four workers** at the owner-selected
`https://vncgi.online/upload/`. Existing root site and Remote UI remain
in their existing services. The new process only serves `/upload/` and `/upload/api/*`.

## Processing and storage

### Chunk-size deployment (2026-09-05)

Upload container deployed at `9b5dee265486424e1c75d410cebd1ebd8d26016e`,
after [CI 33961850302](https://github.com/rajnlove/dreamers-remote/actions/runs/33961850302)
passed upload/job tests and image builds. Container healthy; CPU 0.50 and RAM
512 MiB limits unchanged. Backend and Remote web images were not redeployed.

A paired public-path probe through `vncgi.online` (Cloudflare SIN) sent the same
64 MiB + 123 bytes serially at each size: 4 MiB took 17 requests at 2.02 MB/s;
32 MiB took 3 requests at 7.80 MB/s. These are transfer-only measurements from
one run, excluding browser pre-hashing, and do not guarantee other users' speeds.
The legacy create request without `chunkBytes` retained 4 MiB. A deliberately
incorrect 32 MiB checksum returned 422 with offset still zero; subsequent valid
chunks and the short final chunk succeeded. Both probe sessions/files were deleted
without finalizing or creating any encode job.

Tests also cover migration of the legacy SQLite schema, persistent per-session
chunk size across configuration changes/restarts, checksum rollback, and content
equality after resumed writes.

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

New uploads default to **32 MiB** per request (`UPLOAD_CHUNK_MB`, range 4–32).
The size is persisted per upload; legacy database sessions and older open tabs
retain 4 MiB chunks. Resume hashes and slices using that session's stored size,
including after a server restart or configuration change.
The server checks SHA-256 for that chunk,
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
`docker/upload.env.example`. Dockge stack `vncgi-upload` is running and healthy.
The portal and backend are pinned to image commit
`6a6c9af97ddda3f19793ea9d99ec1fb5fc241a52`. GitHub Actions run
[33950232243](https://github.com/rajnlove/dreamers-remote/actions/runs/33950232243)
passed Linux verification and all three image builds. The backend's new service
account authenticated successfully; its source allow-list includes the upload
child. Existing PHP credentials and project roots were preserved.

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
   Live ACL correction: `render_agent` is UID/GID **3000:3000**, distinct from
   portal UID/GID 3001:3001. Existing POSIX ACLs did not grant it access to `online`.
   Added a named UID 3000 traverse-only entry on the `online` parent, without
   changing that parent's default ACL. Within `dreamers-upload`, named users
   3000 and 3001 have directory rwx/file rw permissions and directory default
   entries, allowing both worker and portal to access newly created sources and
   results. Existing owner, group, mask and other entries were preserved; no
   Everyone permission or broad recursive change was applied. Original ACLs
   were backed up outside the web root before mutation. Preserve these defaults
   when changing dataset permissions; do not rely on matching mode bits alone.
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
installed on this development machine; Linux builds ran in GitHub Actions and
the pinned images were started through the authenticated Dockge UI.

## Cloudflare routing

The live remotely managed `cgivn-truenas` tunnel has the path rule
`^/upload(/.*)?$` for `vncgi.online`, targeting `http://192.168.1.92:18090`,
at order 2, before the existing root catch-all at order 3. Other destinations
retain their previous relative order and services. The host binding uses NAS LAN
address `192.168.1.92`; no router/public port forward was added.
`UPLOAD_BIND_IP` in the env example reproduces this bridged-tunnel setup;
the Compose default remains loopback when it is omitted.

Keep the specific path rule **before** the existing `vncgi.online` catch-all. Preserve
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
    service: http://192.168.1.92:18090
  # Existing vncgi.online route and existing final fallback follow here.
```

For remotely managed tunnels, configure the equivalent hostname/path/service in
the dashboard. Bypass caching for `/upload/api/*` and `/upload/`; serve API cookie
responses without caching. Keep HTTPS at the public edge and the origin restricted
to the private tunnel. Ensure any zone-specific request-size rule allows 32 MiB.
Cloudflare documents chunking as a response to large-request 413 errors:
[Cloudflare 413 guidance](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413/).

## Verification and rollout

Local validation performed:

- TypeScript server build and separate React upload production build passed.
- Four Node tests cover authenticated real HTTP streaming, checksum rejection,
  duplicate chunks, interrupted chunk rollback, simultaneous-request limits,
  persistent sessions/offsets after restart, cross-owner and CSRF denial, private
  result downloads including ranges, quota, cleanup and atomic job idempotency.
- 29 targeted agent argument/security tests passed. The full agent run had 122
  passes and one existing hardware-memory metric assertion failure in this Windows
  sandbox (`MetricsCollectorTests.Collect_ReturnsMemoryWithinSaneBounds`).
- Login and the complete empty-state portal were inspected in the in-app browser
  against the real local portal process. The preview has no production engine.

Live checks on 2026-09-05:

- HTTPS `/upload/` returns the new portal (200); existing `/` still returns its
  original site (200). Unauthenticated API and result requests return 401.
- Browser login with the studio account works with the production Secure cookie.
- A 5,322,679-byte CC0 MDN flower MP4 (with a valid padding box) was uploaded in
  two chunks through Cloudflare. Wrong checksum was rejected with 422 and offset
  remained zero. After a valid 4 MiB chunk, a fresh login resumed its saved offset.
- Completion created job **380**; repeating completion returned the same job ID.
  Direct requests for that known source file were denied on both public aliases.
- After the owner installed the Agent update on COMP-01, it advertised
  `upload_input_safety: "1"`. Job 380 initially failed because the worker could
  not read the upload directory. After the targeted ACL correction, retrying the
  same job completed on COMP-01's RTX 5070 Ti. The authenticated result download
  returned a 1,968,992-byte MP4; a byte-range request returned 206 with matching
  bytes. Unauthenticated downloads and direct source/output aliases stayed denied.
- A fresh UUID upload created job **381** and completed without another ACL
  change. Its authenticated output download also passed, verifying inheritance
  for new portal-created source folders and worker-created output files.

Farm follow-up: all four Agents are updated and pass NAS access checks. Fresh
public-portal jobs 382 (CGI-01) and 384 (CGI-Render, GPU 0) completed H.264 NVENC
and downloaded successfully. Job 383 on CGI-DUC failed to initialize NVENC:
the FFmpeg build requires API 13.1, while its installed driver exposes 13.0.
After the owner updated the driver, fresh job **387 completed on CGI-DUC,
worker 4 / GPU 0**, and its authenticated 1,915,699-byte MP4 download passed.
Companion job 386 completed on CGI-01. All four workers have now passed real
H.264 encode/download checks. The exact installed driver version was not read;
capability advertisement alone does not validate GPU driver compatibility.
NVIDIA confirms the original minimum 610.00 driver requirement in the
[SDK 13.1 release notes](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/read-me/index.html).
The existing job scheduler may assign a retry to a different worker.
Do not remove the software-version gate to make old Agents receive public jobs.
Container limits are set in the live Compose configuration; measured cgroup usage
and a host-wide Docker inventory remain unverified because the authenticated
TrueNAS shell requires a separate sudo password. No privilege workaround was used.

Rollback: restore the previous public path rule, stop only `vncgi-upload`, and keep
its state/media while existing jobs drain. Never delete source folders used by a
worker or run global Docker prune. The optional backend idempotency table is
backward compatible and can remain. Document promotion to PRODUCTION and a host
container audit in `CONTAINERS.md` once rollout is verified.

FFmpeg security options used:
[protocol whitelist](https://ffmpeg.org/ffmpeg-protocols.html),
[MOV external references](https://ffmpeg.org/ffmpeg-formats.html#mov_002fmp4_002f3gp).

## File cleanup

Deployed in backend/Upload image `e6e2d0074ea8f247975d08ede5007ddd6c634cbb`.
The live dialog removed five known legacy acceptance uploads (16.9 MiB), while
the owner's real upload and authenticated result download remained available.

Open **File của bạn → Dọn dẹp file**. Select individual records, eligible records,
or the suggested test filenames. Nothing is selected automatically. Review the
actual stored source/result byte total and confirm permanent deletion. The UI
sends one bounded request per record and reports individual failures without
removing untouched entries from the list.

Cleanup checks ownership, session and CSRF, generated UUID paths, active transfers,
downloads and current job state. Queued, assigned, running, cancelled and
unconfirmed submissions stay protected. An engine cleanup claim prevents a failed
job from being retried while its files are being removed; re-upload is required
after that claim. Engine failures never authorize deletion.

Clearing queue history retains minimal `job_file_cleanup` metadata for upload
jobs. Completed/failed records remain downloadable and cleanable from the portal
after their queue rows are deleted. Cancelled records remain blocked. Legacy
jobs deleted before this metadata existed require one administrative verification;
an unexplained 404 is never treated as proof that a worker has stopped.
