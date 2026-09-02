import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyPassword } from "./password.js";
import { getUserByUsername, seedServiceUser } from "./users.js";

// P4-5: seedServiceUser's contract -- see its doc comment in users.ts.
// DB-backed, same "real SQLite" style as the rest of this server's tests
// (see job/repository.test.ts) -- can't run on this dev machine (no
// prebuilt better-sqlite3 binding, no local C++ toolchain to rebuild it),
// but typechecks clean and runs in CI.
function uniqueUsername(): string {
  return `php-service-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

test("seedServiceUser creates a non-admin account that can log in with the given password", async () => {
  const username = uniqueUsername();
  await seedServiceUser(username, "a-real-password-123");

  const user = getUserByUsername(username);
  assert.ok(user, "service user should exist after seeding");
  assert.equal(user!.is_admin, 0, "service account must be non-admin");
  assert.equal(await verifyPassword("a-real-password-123", user!.password_hash), true);
  assert.equal(await verifyPassword("wrong-password", user!.password_hash), false);
});

test("seedServiceUser is a no-op if a user with that username already exists", async () => {
  const username = uniqueUsername();
  await seedServiceUser(username, "first-password");
  const firstUser = getUserByUsername(username);

  // Re-seeding with a different password must NOT change the existing
  // account -- idempotent per-username, not "reset on every boot".
  await seedServiceUser(username, "second-password");
  const afterReseed = getUserByUsername(username);

  assert.equal(afterReseed!.password_hash, firstUser!.password_hash);
  assert.equal(await verifyPassword("first-password", afterReseed!.password_hash), true);
  assert.equal(await verifyPassword("second-password", afterReseed!.password_hash), false);
});

test("seedServiceUser coexists with an existing admin account rather than being blocked by it", async () => {
  // seedAdminUser's "any user exists" no-op guard must not apply here --
  // a service account created after the admin account already exists is
  // exactly the normal deployment order (admin seeded first at initial
  // setup, PHP_SERVICE_PASSWORD added later).
  const username = uniqueUsername();
  const before = getUserByUsername("admin");
  await seedServiceUser(username, "svc-password");
  const after = getUserByUsername(username);

  assert.ok(after, "service account should be created even though other users already exist");
  if (before) {
    assert.equal(getUserByUsername("admin")?.id, before.id, "admin account must be untouched");
  }
});
