import { test } from "node:test";
import assert from "node:assert/strict";
import { transferDeadline, CHUNK_IDLE_MS, CHUNK_MAX_MS } from "./transferDeadline.js";

test("slow transfer survives the former 90-second limit while data arrives", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const errors: string[] = [];
  const deadline = transferDeadline(reason => errors.push(reason));
  for (let n = 0; n < 5; n++) { t.mock.timers.tick(30_000); deadline.progress(); }
  assert.deepEqual(errors, []);
  deadline.close();
  t.mock.timers.tick(CHUNK_MAX_MS);
  assert.deepEqual(errors, []);
});

test("a stalled transfer expires once and cannot be revived by late progress", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const errors: string[] = [];
  const deadline = transferDeadline(reason => errors.push(reason));
  t.mock.timers.tick(CHUNK_IDLE_MS);
  assert.deepEqual(errors, ["Chunk stalled without data"]);
  deadline.progress(); t.mock.timers.tick(CHUNK_MAX_MS);
  assert.equal(errors.length, 1);
});

test("continuous trickle cannot hold a transfer slot indefinitely", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const errors: string[] = [];
  const deadline = transferDeadline(reason => errors.push(reason));
  for (let n = 0; n < CHUNK_MAX_MS / 30_000; n++) { t.mock.timers.tick(30_000); deadline.progress(); }
  assert.deepEqual(errors, ["Chunk maximum duration exceeded"]);
});
