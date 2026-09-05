import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createJobOnce } from "./idempotency.js";
import { db } from "../database/db.js";

test("job request retries return the same job, reject changed payload and retain deleted tombstones", () => {
  const key = randomUUID();
  const input = { type: "test", priority: 0, input: null, depends_on: null, required_software: null };
  const first = createJobOnce(901, key, input);
  assert.equal(createJobOnce(901, key, input).id, first.id);
  assert.throws(() => createJobOnce(901, key, { ...input, priority: 1 }), /different input/);
  assert.notEqual(createJobOnce(902, key, input).id, first.id);
  db.prepare("DELETE FROM jobs WHERE id = ?").run(first.id);
  assert.throws(() => createJobOnce(901, key, input), /removed/);
});
