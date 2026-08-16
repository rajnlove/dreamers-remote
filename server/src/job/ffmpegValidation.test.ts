import assert from "node:assert/strict";
import { test } from "node:test";
import { isPathUnderAllowedRoot, validateFfmpegInput } from "./ffmpegValidation.js";

const ROOTS = ["\\\\192.29.11.92\\Projects"];

test("isPathUnderAllowedRoot accepts an exact root and a subpath", () => {
  assert.equal(isPathUnderAllowedRoot("\\\\192.29.11.92\\Projects", ROOTS), true);
  assert.equal(isPathUnderAllowedRoot("\\\\192.29.11.92\\Projects\\job1\\in.mov", ROOTS), true);
});

test("isPathUnderAllowedRoot is case-insensitive and slash-tolerant", () => {
  assert.equal(isPathUnderAllowedRoot("\\\\192.29.11.92\\PROJECTS\\x.mov", ROOTS), true);
  assert.equal(isPathUnderAllowedRoot("//192.29.11.92/Projects/x.mov", ROOTS), true);
});

test("isPathUnderAllowedRoot rejects a sibling path that merely shares a prefix", () => {
  assert.equal(isPathUnderAllowedRoot("\\\\192.29.11.92\\ProjectsOther\\x.mov", ROOTS), false);
});

test("isPathUnderAllowedRoot rejects any path containing ..", () => {
  assert.equal(
    isPathUnderAllowedRoot("\\\\192.29.11.92\\Projects\\..\\..\\Windows\\System32\\x.exe", ROOTS),
    false,
  );
});

test("isPathUnderAllowedRoot rejects everything when no roots are configured", () => {
  assert.equal(isPathUnderAllowedRoot("\\\\192.29.11.92\\Projects\\x.mov", []), false);
});

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    sourcePath: "\\\\192.29.11.92\\Projects\\job1\\in.mov",
    outputPath: "\\\\192.29.11.92\\Projects\\job1\\out.mp4",
    codec: "h264_nvenc",
    qualityMode: "cq",
    ...overrides,
  };
}

test("validateFfmpegInput accepts a well-formed minimal input and applies defaults", () => {
  const result = validateFfmpegInput(validInput(), ROOTS);
  assert.deepEqual(result, {
    projectId: null,
    sourcePath: "\\\\192.29.11.92\\Projects\\job1\\in.mov",
    outputPath: "\\\\192.29.11.92\\Projects\\job1\\out.mp4",
    codec: "h264_nvenc",
    qualityMode: "cq",
    quality: null,
    bitrate: null,
    preset: "p6",
    resolution: null,
    audioCodec: "aac",
  });
});

test("validateFfmpegInput rejects a sourcePath outside the allowed roots", () => {
  assert.throws(() => validateFfmpegInput(validInput({ sourcePath: "C:\\Users\\x\\in.mov" }), ROOTS));
});

test("validateFfmpegInput rejects an outputPath outside the allowed roots", () => {
  assert.throws(() => validateFfmpegInput(validInput({ outputPath: "\\\\evil-nas\\Projects\\out.mp4" }), ROOTS));
});

test("validateFfmpegInput rejects an invalid codec", () => {
  assert.throws(() => validateFfmpegInput(validInput({ codec: "mpeg2" }), ROOTS));
});

test("validateFfmpegInput rejects a missing qualityMode", () => {
  const { qualityMode, ...rest } = validInput();
  assert.throws(() => validateFfmpegInput(rest, ROOTS));
});

test("validateFfmpegInput rejects an out-of-range quality", () => {
  assert.throws(() => validateFfmpegInput(validInput({ quality: 52 }), ROOTS));
  assert.throws(() => validateFfmpegInput(validInput({ quality: -1 }), ROOTS));
});

test("validateFfmpegInput accepts an in-range quality", () => {
  const result = validateFfmpegInput(validInput({ quality: 19 }), ROOTS);
  assert.equal(result.quality, 19);
});

test("validateFfmpegInput rejects a malformed bitrate", () => {
  assert.throws(() => validateFfmpegInput(validInput({ bitrate: "eight megabits" }), ROOTS));
});

test("validateFfmpegInput accepts a well-formed bitrate", () => {
  const result = validateFfmpegInput(validInput({ bitrate: "8M" }), ROOTS);
  assert.equal(result.bitrate, "8M");
});

test("validateFfmpegInput rejects a malformed resolution", () => {
  assert.throws(() => validateFfmpegInput(validInput({ resolution: "1920p" }), ROOTS));
});

test("validateFfmpegInput accepts a well-formed resolution", () => {
  const result = validateFfmpegInput(validInput({ resolution: "1920x1080" }), ROOTS);
  assert.equal(result.resolution, "1920x1080");
});

test("validateFfmpegInput rejects an invalid audioCodec", () => {
  assert.throws(() => validateFfmpegInput(validInput({ audioCodec: "mp3" }), ROOTS));
});

test("validateFfmpegInput rejects an empty projectId", () => {
  assert.throws(() => validateFfmpegInput(validInput({ projectId: "" }), ROOTS));
});

test("validateFfmpegInput accepts a projectId", () => {
  const result = validateFfmpegInput(validInput({ projectId: "proj-42" }), ROOTS);
  assert.equal(result.projectId, "proj-42");
});
