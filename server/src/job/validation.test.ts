import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCreateInput } from "./validation.js";

test("validateCreateInput accepts a minimal job and applies defaults", () => {
  const result = validateCreateInput({ type: "test" });
  assert.deepEqual(result, { type: "test", priority: 0, input: null, depends_on: null, required_software: null });
});

test("validateCreateInput trims type and keeps a given priority/input/depends_on", () => {
  const result = validateCreateInput({ type: "  test  ", priority: 5, input: '{"seconds":10}', depends_on: 3 });
  assert.deepEqual(result, {
    type: "test",
    priority: 5,
    input: '{"seconds":10}',
    depends_on: 3,
    required_software: null,
  });
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

test("validateCreateInput accepts a required_software object", () => {
  const result = validateCreateInput({ type: "test", required_software: { test: "1.0.0" } });
  assert.deepEqual(result.required_software, { test: "1.0.0" });
});

test("validateCreateInput rejects a non-object required_software", () => {
  assert.throws(() => validateCreateInput({ type: "test", required_software: "1.0.0" }));
  assert.throws(() => validateCreateInput({ type: "test", required_software: ["1.0.0"] }));
});

test("validateCreateInput rejects a required_software entry with a non-string version", () => {
  assert.throws(() => validateCreateInput({ type: "test", required_software: { test: 1 } }));
  assert.throws(() => validateCreateInput({ type: "test", required_software: { test: "" } }));
});

test("validateCreateInput rejects a malformed-JSON input for an ffmpeg job", () => {
  assert.throws(() => validateCreateInput({ type: "ffmpeg", input: "{not json" }));
});

test("validateCreateInput rejects an ffmpeg job whose input fails the ffmpeg-specific shape check", () => {
  // No FFMPEG_ALLOWED_ROOTS configured in this test process, so any
  // path fails -- confirms validateCreateInput actually dispatches to
  // validateFfmpegInput rather than accepting ffmpeg input as opaque
  // free-form text like other job types.
  assert.throws(() =>
    validateCreateInput({
      type: "ffmpeg",
      input: JSON.stringify({ sourcePath: "C:\\x.mov", outputPath: "C:\\y.mp4", codec: "h264_nvenc", qualityMode: "cq" }),
    }),
  );
});
