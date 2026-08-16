import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCreateInput } from "./validation.js";

test("validateCreateInput accepts a minimal job and applies defaults", () => {
  const result = validateCreateInput({ type: "test" });
  assert.deepEqual(result, { type: "test", priority: 0, input: null, depends_on: null });
});

test("validateCreateInput trims type and keeps a given priority/input/depends_on", () => {
  const result = validateCreateInput({ type: "  test  ", priority: 5, input: '{"seconds":10}', depends_on: 3 });
  assert.deepEqual(result, { type: "test", priority: 5, input: '{"seconds":10}', depends_on: 3 });
});

test("validateCreateInput rejects a non-positive-integer depends_on", () => {
  assert.throws(() => validateCreateInput({ type: "test", depends_on: 0 }));
  assert.throws(() => validateCreateInput({ type: "test", depends_on: -1 }));
  assert.throws(() => validateCreateInput({ type: "test", depends_on: 1.5 }));
  assert.throws(() => validateCreateInput({ type: "test", depends_on: "not-a-number" }));
});

test("validateCreateInput rejects a missing or empty type", () => {
  assert.throws(() => validateCreateInput({}));
  assert.throws(() => validateCreateInput({ type: "" }));
  assert.throws(() => validateCreateInput({ type: "   " }));
});

test("validateCreateInput rejects a non-integer priority", () => {
  assert.throws(() => validateCreateInput({ type: "test", priority: 1.5 }));
  assert.throws(() => validateCreateInput({ type: "test", priority: "high" }));
});

test("validateCreateInput rejects a non-string input", () => {
  assert.throws(() => validateCreateInput({ type: "test", input: { seconds: 10 } }));
});
