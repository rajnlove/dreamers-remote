import assert from "node:assert/strict";
import { test } from "node:test";
import { validateTopazInput } from "./topazValidation.js";

const ROOTS = ["\\\\192.29.11.92\\Projects"];

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    sourcePath: "\\\\192.29.11.92\\Projects\\job1\\in.mov",
    outputPath: "\\\\192.29.11.92\\Projects\\job1\\out.mp4",
    model: "iris-2",
    scale: 2,
    codec: "h264_nvenc",
    qualityMode: "cq",
    ...overrides,
  };
}

test("validateTopazInput accepts a well-formed minimal input and applies defaults", () => {
  const result = validateTopazInput(validInput(), ROOTS);
  assert.deepEqual(result, {
    projectId: null,
    sourcePath: "\\\\192.29.11.92\\Projects\\job1\\in.mov",
    outputPath: "\\\\192.29.11.92\\Projects\\job1\\out.mp4",
    model: "iris-2",
    scale: 2,
    codec: "h264_nvenc",
    qualityMode: "cq",
    quality: null,
    bitrate: null,
    preset: "p6",
    audioCodec: "aac",
  });
});

test("validateTopazInput rejects a sourcePath outside the allowed roots", () => {
  assert.throws(() => validateTopazInput(validInput({ sourcePath: "C:\\Users\\x\\in.mov" }), ROOTS));
});

test("validateTopazInput rejects an outputPath outside the allowed roots", () => {
  assert.throws(() => validateTopazInput(validInput({ outputPath: "\\\\evil-nas\\Projects\\out.mp4" }), ROOTS));
});

test("validateTopazInput rejects an invalid codec", () => {
  assert.throws(() => validateTopazInput(validInput({ codec: "mpeg2" }), ROOTS));
});

test("validateTopazInput rejects a missing model", () => {
  const { model, ...rest } = validInput();
  assert.throws(() => validateTopazInput(rest, ROOTS));
});

test("validateTopazInput rejects a model name with filter-graph-syntax characters", () => {
  assert.throws(() => validateTopazInput(validInput({ model: "iris:2" }), ROOTS));
  assert.throws(() => validateTopazInput(validInput({ model: "iris,2" }), ROOTS));
  assert.throws(() => validateTopazInput(validInput({ model: "iris;other" }), ROOTS));
  assert.throws(() => validateTopazInput(validInput({ model: "" }), ROOTS));
});

test("validateTopazInput accepts a well-formed model name", () => {
  const result = validateTopazInput(validInput({ model: "proteus-3" }), ROOTS);
  assert.equal(result.model, "proteus-3");
});

test("validateTopazInput rejects an out-of-range scale", () => {
  assert.throws(() => validateTopazInput(validInput({ scale: 0 }), ROOTS));
  assert.throws(() => validateTopazInput(validInput({ scale: 5 }), ROOTS));
  assert.throws(() => validateTopazInput(validInput({ scale: 1.5 }), ROOTS));
});

test("validateTopazInput rejects a missing qualityMode", () => {
  const { qualityMode, ...rest } = validInput();
  assert.throws(() => validateTopazInput(rest, ROOTS));
});

test("validateTopazInput rejects an out-of-range quality", () => {
  assert.throws(() => validateTopazInput(validInput({ quality: 52 }), ROOTS));
  assert.throws(() => validateTopazInput(validInput({ quality: -1 }), ROOTS));
});

test("validateTopazInput rejects a malformed bitrate", () => {
  assert.throws(() => validateTopazInput(validInput({ bitrate: "eight megabits" }), ROOTS));
});

test("validateTopazInput rejects an invalid audioCodec", () => {
  assert.throws(() => validateTopazInput(validInput({ audioCodec: "mp3" }), ROOTS));
});

test("validateTopazInput rejects an empty projectId", () => {
  assert.throws(() => validateTopazInput(validInput({ projectId: "" }), ROOTS));
});

test("validateTopazInput accepts a projectId", () => {
  const result = validateTopazInput(validInput({ projectId: "proj-42" }), ROOTS);
  assert.equal(result.projectId, "proj-42");
});
