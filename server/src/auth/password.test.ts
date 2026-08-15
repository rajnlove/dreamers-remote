import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "./password.js";

test("hashPassword produces a different hash each time (random salt)", async () => {
  const a = await hashPassword("correct horse battery staple");
  const b = await hashPassword("correct horse battery staple");
  assert.notEqual(a, b);
});

test("verifyPassword accepts the correct password", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
});

test("verifyPassword rejects an incorrect password", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("wrong password", hash), false);
});

test("verifyPassword rejects a malformed stored hash", async () => {
  assert.equal(await verifyPassword("anything", "not-a-valid-hash"), false);
});
