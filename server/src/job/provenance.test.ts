import assert from "node:assert/strict";
import { test } from "node:test";
import { validateOrigin, validateProvenance } from "./provenance.js";
import { validateCreateInput } from "./validation.js";

test("validateOrigin accepts the known enum and rejects anything else", () => {
  assert.equal(validateOrigin("website_shot_version"), "website_shot_version");
  assert.equal(validateOrigin("internal_test"), "internal_test");
  assert.equal(validateOrigin(undefined), null);
  assert.equal(validateOrigin(null), null);
  // A made-up origin is rejected outright rather than stored as-is:
  // the badge on the queue page is a claim about where work came from,
  // so an unrecognised value must not be able to render as one.
  assert.throws(() => validateOrigin("website_admin_superuser"), /origin must be one of/);
  assert.throws(() => validateOrigin(7), /origin must be one of/);
});

test("validateProvenance keeps the fields a website sends and normalizes uploaded_at to ISO UTC", () => {
  const result = validateProvenance({
    project_id: "P-1",
    project_name: "  Demo Project  ",
    shot_code: "SH0030",
    version_no: "4",
    uploaded_by_name: "artist.one",
    uploaded_at: "2026-09-05T11:00:00+07:00",
  })!;

  assert.equal(result.project_id, "P-1");
  assert.equal(result.project_name, "Demo Project");
  assert.equal(result.shot_code, "SH0030");
  assert.equal(result.version_no, 4);
  assert.equal(result.uploaded_at, "2026-09-05T04:00:00.000Z");
  // Unsent fields are explicitly null, never undefined -- the stored
  // JSON is then the same shape for every job, so the UI can render
  // "not provided" without guessing whether a key was omitted.
  assert.equal(result.shot_id, null);
  assert.equal(result.job_name, null);
});

test("validateProvenance treats an empty or all-null object as no provenance at all", () => {
  assert.equal(validateProvenance({}), null);
  assert.equal(validateProvenance({ project_id: "", shot_code: null }), null);
  assert.equal(validateProvenance(undefined), null);
});

test("validateProvenance rejects malformed metadata", () => {
  assert.throws(() => validateProvenance("website"), /provenance must be an object/);
  assert.throws(() => validateProvenance([]), /provenance must be an object/);
  assert.throws(() => validateProvenance({ project_id: { nested: true } }), /project_id must be a string/);
  assert.throws(() => validateProvenance({ version_no: "not-a-number" }), /version_no must be a non-negative integer/);
  assert.throws(() => validateProvenance({ version_no: -1 }), /version_no must be a non-negative integer/);
  assert.throws(() => validateProvenance({ uploaded_at: "yesterday" }), /uploaded_at must be an ISO 8601 date/);
  assert.throws(() => validateProvenance({ project_name: "x".repeat(201) }), /at most 200 characters/);
});

test("validateCreateInput carries provenance through and stays backward compatible without it", () => {
  const withProvenance = validateCreateInput({
    type: "ffmpeg",
    origin: "website_project_upload",
    provenance: { project_name: "Demo", uploaded_by_name: "artist.one" },
  });
  assert.equal(withProvenance.origin, "website_project_upload");
  assert.equal(withProvenance.provenance?.project_name, "Demo");

  // The exact body an older client (or any internal script) sends --
  // it must still create a job, just without provenance.
  const legacy = validateCreateInput({ type: "test" });
  assert.equal(legacy.origin, null);
  assert.equal(legacy.provenance, null);
  assert.equal(legacy.type, "test");
});
