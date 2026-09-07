import assert from "node:assert/strict";
import { test } from "node:test";
import { isAuditAction, AUDIT_ACTIONS } from "./actions.js";

// The repository's insert/list paths need the real better-sqlite3 binding
// (database/db.ts opens a connection at import time), which does not load on
// this Windows workstation — the module's prebuilt ABI does not match Node 24.
// Same constraint already documented for job/repository.test.ts. These cases
// cover the pure guard that every call site and the API filter depend on;
// the query paths are exercised in the Linux verification run.

test("isAuditAction accepts every declared action", () => {
  for (const action of AUDIT_ACTIONS) {
    assert.equal(isAuditAction(action), true, `${action} should be valid`);
  }
});

test("isAuditAction rejects anything outside the enum", () => {
  assert.equal(isAuditAction("login"), false);
  assert.equal(isAuditAction("workstation.created"), false);
  assert.equal(isAuditAction(""), false);
  assert.equal(isAuditAction(undefined), false);
  assert.equal(isAuditAction(null), false);
  assert.equal(isAuditAction(42), false);
});

test("action names stay in <subject>.<verb> shape so the UI can group them", () => {
  for (const action of AUDIT_ACTIONS) {
    assert.match(action, /^[a-z]+(\.[a-z_]+)?$/, `${action} has an unexpected shape`);
  }
});

test("no duplicate actions", () => {
  assert.equal(new Set(AUDIT_ACTIONS).size, AUDIT_ACTIONS.length);
});
