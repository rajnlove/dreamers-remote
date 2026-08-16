# Docker / Container Lifecycle Rule

Every Docker container, service, image, volume, or network created for
this project must have a documented purpose and lifecycle — no
container exists without someone being able to say why.

## 1. Required status

Every container/service must be in exactly one state:

- **PRODUCTION** — actively used by the real system. Never delete
  without confirming no dependency first.
- **TEST** — created to try out a feature. Once testing is done, decide:
  **promote** to PRODUCTION or **remove**. Never left in limbo.
- **TEMPORARY** — serves a one-off debug/build/migration purpose. Must
  be removed once that purpose is done.
- **FUTURE** — not used yet, but a specific later phase is expected to
  need it. Must note which phase/feature that is.
- **DEPRECATED** — superseded by something else. Clean up once no
  dependency on it is confirmed.

## 2. No unexplained containers

Nothing like `vncgi-remote-93`, `vncgi-test-2`, `remote-temp`,
`server-old` may exist without documentation explaining it. If a
container was created with an auto-generated/random suffix, figure out:
who created it, which service created it, why, whether it's still in
use, and whether it can be renamed or cleaned up.

## 3. Container registry: docs/CONTAINERS.md

[docs/CONTAINERS.md](CONTAINERS.md) tracks every container with columns
`Container | Status | Purpose | Required | Phase | Notes`. Update it on
every Docker-related change — new service, status change, removal.

## 4. Post-milestone audit

After finishing a milestone, audit what's actually running on the
TrueNAS host:

```bash
docker ps -a
docker images
docker volume ls
docker network ls
```

Then check: what's in active use, what's stopped, what's a leftover
test, what's orphaned, which images have no reference left, which
volumes hold data still needed.

## 5. Cleanup rule

Never run `docker system prune -a` on the TrueNAS production host.
Never delete a container/volume just because it's `Exited`. Before
removing anything, confirm all four:

1. No dependency on it.
2. No data in it that's still needed.
3. Not something the next phase is about to use.
4. Not a rollback version kept on purpose.

If it's genuinely not needed: **STOP → VERIFY → REMOVE**. If it'll be
needed later: **KEEP**, mark **FUTURE**, and write down why and which
phase.

## 6. Test containers

A container created to test something (e.g. `vncgi-test-<feature>`)
must immediately get a note: status TEST, what it's for, expected
lifetime, and the condition under which it gets cleaned up. Once the
test is done, it must be explicitly promoted or removed — never left
sitting.

## 7. Naming convention

- Production: `vncgi-remote-server`, `vncgi-remote-web`,
  `vncgi-remote-proxy`, `vncgi-agent-api` — descriptive, no random
  suffixes.
- Test: `vncgi-test-<feature>`.
- Temporary: `vncgi-temp-<purpose>`.
- Future services still get a clear name, never a random number.

## 8. docs/PROJECT_STATUS.md

Keep a "Docker Status" section there, grouped by lifecycle state (see
that file for the current list) — a quick-glance summary; the full
detail with purpose/phase/notes lives in `docs/CONTAINERS.md`.

## 9. Rule for an AI coding agent working in this repo

Before creating a new Docker service:

1. Check what already exists.
2. Confirm there isn't an equivalent service already.
3. State why the new service is needed.
4. Use a clear, descriptive name.
5. Update `docs/CONTAINERS.md`.

After testing:

1. Decide whether the service is still needed.
2. If yes → mark PRODUCTION or FUTURE.
3. If no → clean it up safely (STOP → VERIFY → REMOVE).
4. Update the documentation.

Never leave a test/orphan container undocumented. Never run destructive
cleanup commands on the TrueNAS host without the user's explicit
confirmation first — this is a shared-infrastructure action, not a
routine one (see the repo-wide safety rules this agent operates under).
