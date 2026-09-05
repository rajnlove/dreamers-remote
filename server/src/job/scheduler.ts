import { db } from "../database/db.js";
import { listWorkers } from "./workers.js";
import { failStaleRunningJobs, isDependencySatisfied } from "./repository.js";
import type { Job } from "./types.js";
import type { WorkerInfo } from "./workers.js";

export interface SlotKey {
  workerId: number;
  gpuSlot: number | null;
}

export function slotKeyString(k: SlotKey): string {
  return `${k.workerId}:${k.gpuSlot ?? "none"}`;
}

// P3-6: hardcoded for now — MASTER_PROJECT_SPEC.md §11 calls for these
// to eventually be admin-configurable per workstation (a real settings
// UI is Phase 6/7 Studio Control Center territory, premature here).
// Sane defaults so "don't pile more work onto an already-maxed-out
// machine" exists at all before that UI does. Exported for the
// scheduler smoke-test.
export const CPU_THRESHOLD_PERCENT = 90;
export const MEMORY_THRESHOLD_PERCENT = 90;
export const GPU_THRESHOLD_PERCENT = 90;

// A worker's assignable units: one per reported GPU slot, or — for a
// worker with no GPU (pure CPU capacity) — itself as a single unit
// with gpu_slot left null. Exported for the scheduler smoke-test.
export function workerUnits(worker: WorkerInfo): SlotKey[] {
  if (worker.gpuSlots.length === 0) {
    return [{ workerId: worker.workstationId, gpuSlot: null }];
  }
  return worker.gpuSlots.map((s) => ({ workerId: worker.workstationId, gpuSlot: s.gpuIndex }));
}

// P3-8: mechanism only -- exact-match per entry, no version-range/
// semver comparison (nothing real to compare against yet; see
// MASTER_PROJECT_SPEC.md §16). A worker with no matching entry at all
// for a required software name is incompatible, same as a missing
// capability. Exported for the scheduler smoke-test/unit tests.
export function softwareRequirementsSatisfied(
  worker: WorkerInfo,
  requiredSoftware: Record<string, string> | null,
): boolean {
  if (!requiredSoftware) return true;
  return Object.entries(requiredSoftware).every(
    ([name, version]) => worker.softwareVersions[name] === version,
  );
}

// Pure — no DB access, so it's unit-testable on its own (see
// scheduler.test.ts). Picks the first online, enabled, capability-
// matching, software-compatible, under-threshold worker with a free
// (and, for a GPU unit, under-threshold) unit, FIFO over the `workers`
// array order — the array itself is expected to already be
// priority-sorted by the caller (P3-6; findAssignment doesn't sort, it
// just walks in order). Returns null if nothing can take the job right
// now (it stays QUEUED, tried again next tick).
export function findAssignment(
  jobType: string,
  workers: WorkerInfo[],
  busy: ReadonlySet<string>,
  requiredSoftware: Record<string, string> | null = null,
): SlotKey | null {
  for (const worker of workers) {
    if (!worker.agentOnline) continue;
    if (!worker.jobsEnabled) continue;
    if (!worker.capabilities.includes(jobType)) continue;
    if (!softwareRequirementsSatisfied(worker, requiredSoftware)) continue;
    if ((worker.cpuUtilizationPercent ?? 0) >= CPU_THRESHOLD_PERCENT) continue;
    if ((worker.memoryUsagePercent ?? 0) >= MEMORY_THRESHOLD_PERCENT) continue;

    const freeUnit = workerUnits(worker).find((u) => {
      if (busy.has(slotKeyString(u))) return false;
      if (u.gpuSlot === null) return true;
      // A GPU can be heavily used by something outside the job engine
      // entirely (an artist's interactive session) without one of our
      // jobs occupying it — busy-set alone wouldn't catch that.
      const gpu = worker.gpuSlots.find((s) => s.gpuIndex === u.gpuSlot);
      return (gpu?.utilizationPercent ?? 0) < GPU_THRESHOLD_PERCENT;
    });
    if (freeUnit) return freeUnit;
  }
  return null;
}

// P3-3/P3-5/P3-6: priority-ordered (ties broken FIFO by id), capability
// + GPU-slot-aware, threshold-gated assignment, skipping jobs whose
// dependency isn't satisfied yet. Called after a job is created and on
// every Agent heartbeat (may have just brought a worker online, freed a
// slot by completing a job, or — P3-5 — gone stale mid-job) — safe to
// call redundantly, a no-op if there's nothing to do.
export function runScheduler(): void {
  // Unconditional, before the queued-jobs early return below: a job
  // whose worker died mid-run needs to be freed up even on a tick with
  // nothing new to assign.
  failStaleRunningJobs();

  const queued = db
    .prepare(`SELECT * FROM jobs WHERE status = 'QUEUED' ORDER BY priority DESC, id ASC`)
    .all() as Job[];
  if (queued.length === 0) return;

  const workers = listWorkers();
  const busyRows = db
    .prepare(`SELECT worker_id, gpu_slot FROM jobs WHERE status IN ('ASSIGNED', 'RUNNING')`)
    .all() as Array<{ worker_id: number; gpu_slot: number | null }>;
  const busy = new Set(busyRows.map((r) => slotKeyString({ workerId: r.worker_id, gpuSlot: r.gpu_slot })));

  for (const job of queued) {
    if (!isDependencySatisfied(job)) continue;

    const requiredSoftware = job.required_software ? (JSON.parse(job.required_software) as Record<string, string>) : null;
    const assignment = findAssignment(job.type, workers, busy, requiredSoftware);
    if (!assignment) continue;

    db.prepare(
      `UPDATE jobs SET status = 'ASSIGNED', worker_id = ?, gpu_slot = ?, assigned_at = ? WHERE id = ?`,
    ).run(assignment.workerId, assignment.gpuSlot, new Date().toISOString(), job.id);
    busy.add(slotKeyString(assignment));
  }
}
