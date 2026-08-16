import assert from "node:assert/strict";
import { test } from "node:test";
import { findAssignment, slotKeyString, softwareRequirementsSatisfied, workerUnits } from "./scheduler.js";
import type { WorkerInfo } from "./workers.js";

function worker(overrides: Partial<WorkerInfo> = {}): WorkerInfo {
  return {
    workstationId: 1,
    workstationName: "W1",
    agentOnline: true,
    jobsEnabled: true,
    capabilities: ["test"],
    softwareVersions: {},
    gpuSlots: [],
    cpuUtilizationPercent: 10,
    memoryUsagePercent: 10,
    ...overrides,
  };
}

test("workerUnits treats a GPU-less worker as one CPU-only unit", () => {
  const units = workerUnits(worker());
  assert.deepEqual(units, [{ workerId: 1, gpuSlot: null }]);
});

test("workerUnits produces one unit per reported GPU", () => {
  const units = workerUnits(
    worker({
      gpuSlots: [
        { workstationId: 1, workstationName: "W1", gpuIndex: 0, gpuName: "RTX 3090", utilizationPercent: 0 },
        { workstationId: 1, workstationName: "W1", gpuIndex: 1, gpuName: "RTX 3090", utilizationPercent: 0 },
      ],
    }),
  );
  assert.deepEqual(units, [
    { workerId: 1, gpuSlot: 0 },
    { workerId: 1, gpuSlot: 1 },
  ]);
});

test("findAssignment picks the first online, capability-matching worker with a free unit", () => {
  const workers = [worker({ workstationId: 1, agentOnline: false }), worker({ workstationId: 2 })];
  const result = findAssignment("test", workers, new Set());
  assert.deepEqual(result, { workerId: 2, gpuSlot: null });
});

test("findAssignment skips a worker without the required capability", () => {
  const workers = [worker({ capabilities: ["ffmpeg"] })];
  assert.equal(findAssignment("test", workers, new Set()), null);
});

test("findAssignment skips units already marked busy", () => {
  const w = worker({
    gpuSlots: [{ workstationId: 1, workstationName: "W1", gpuIndex: 0, gpuName: "RTX 3090", utilizationPercent: 0 }],
  });
  const busy = new Set([slotKeyString({ workerId: 1, gpuSlot: 0 })]);
  assert.equal(findAssignment("test", [w], busy), null);
});

test("findAssignment returns null when nothing can take the job", () => {
  assert.equal(findAssignment("test", [], new Set()), null);
});

test("softwareRequirementsSatisfied is true when no requirement given", () => {
  assert.equal(softwareRequirementsSatisfied(worker({ softwareVersions: {} }), null), true);
});

test("softwareRequirementsSatisfied is true on an exact match", () => {
  assert.equal(
    softwareRequirementsSatisfied(worker({ softwareVersions: { test: "1.0.0" } }), { test: "1.0.0" }),
    true,
  );
});

test("softwareRequirementsSatisfied is false on a version mismatch", () => {
  assert.equal(
    softwareRequirementsSatisfied(worker({ softwareVersions: { test: "1.0.0" } }), { test: "2.0.0" }),
    false,
  );
});

test("softwareRequirementsSatisfied is false when the software is missing entirely", () => {
  assert.equal(softwareRequirementsSatisfied(worker({ softwareVersions: {} }), { test: "1.0.0" }), false);
});

test("findAssignment skips a worker with an incompatible software version", () => {
  const workers = [worker({ softwareVersions: { test: "0.9.0" } })];
  assert.equal(findAssignment("test", workers, new Set(), { test: "1.0.0" }), null);
});

test("findAssignment picks a worker with a compatible software version", () => {
  const workers = [worker({ softwareVersions: { test: "1.0.0" } })];
  assert.deepEqual(findAssignment("test", workers, new Set(), { test: "1.0.0" }), { workerId: 1, gpuSlot: null });
});
