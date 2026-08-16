import { db } from "../database/db.js";
import { listWorkers } from "./workers.js";
import type { Job } from "./types.js";
import type { WorkerInfo } from "./workers.js";

export interface SlotKey {
  workerId: number;
  gpuSlot: number | null;
}

export function slotKeyString(k: SlotKey): string {
  return `${k.workerId}:${k.gpuSlot ?? "none"}`;
}

// A worker's assignable units: one per reported GPU slot, or — for a
// worker with no GPU (pure CPU capacity) — itself as a single unit
// with gpu_slot left null. Exported for the scheduler smoke-test.
export function workerUnits(worker: WorkerInfo): SlotKey[] {
  if (worker.gpuSlots.length === 0) {
    return [{ workerId: worker.workstationId, gpuSlot: null }];
  }
  return worker.gpuSlots.map((s) => ({ workerId: worker.workstationId, gpuSlot: s.gpuIndex }));
}

// Pure — no DB access, so it's unit-testable on its own (see
// scheduler.test.ts). Picks the first online, capability-matching
// worker with a free unit, FIFO over the `workers` array order (P3-3:
// no priority ordering yet — that's P3-6). Returns null if nothing can
// take the job right now (it stays QUEUED, tried again next tick).
export function findAssignment(jobType: string, workers: WorkerInfo[], busy: ReadonlySet<string>): SlotKey | null {
  for (const worker of workers) {
    if (!worker.agentOnline) continue;
    if (!worker.capabilities.includes(jobType)) continue;

    const freeUnit = workerUnits(worker).find((u) => !busy.has(slotKeyString(u)));
    if (freeUnit) return freeUnit;
  }
  return null;
}

// P3-3: FIFO, capability-matched, GPU-slot-aware assignment. No
// priority ordering or dependency graph yet (P3-6). Called after a job
// is created and on every Agent heartbeat (agent/heartbeat may have
// just brought a worker online or, later, freed a slot by completing a
// job) — safe to call redundantly, a no-op if there's nothing to do.
// Nothing executes the job yet (P3-4); this only flips QUEUED -> ASSIGNED.
export function runScheduler(): void {
  const queued = db.prepare(`SELECT * FROM jobs WHERE status = 'QUEUED' ORDER BY id ASC`).all() as Job[];
  if (queued.length === 0) return;

  const workers = listWorkers();
  const busyRows = db
    .prepare(`SELECT worker_id, gpu_slot FROM jobs WHERE status IN ('ASSIGNED', 'RUNNING')`)
    .all() as Array<{ worker_id: number; gpu_slot: number | null }>;
  const busy = new Set(busyRows.map((r) => slotKeyString({ workerId: r.worker_id, gpuSlot: r.gpu_slot })));

  for (const job of queued) {
    const assignment = findAssignment(job.type, workers, busy);
    if (!assignment) continue;

    db.prepare(`UPDATE jobs SET status = 'ASSIGNED', worker_id = ?, gpu_slot = ? WHERE id = ?`).run(
      assignment.workerId,
      assignment.gpuSlot,
      job.id,
    );
    busy.add(slotKeyString(assignment));
  }
}
