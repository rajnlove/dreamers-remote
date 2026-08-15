import assert from "node:assert/strict";
import { test } from "node:test";
import { generateSecret, hashSecret, secretMatchesHash } from "./crypto.js";

test("generateSecret produces a different value each time", () => {
  const a = generateSecret();
  const b = generateSecret();
  assert.notEqual(a, b);
  assert.equal(a.length, 64); // 32 bytes hex-encoded
});

test("hashSecret is deterministic", () => {
  const secret = generateSecret();
  assert.equal(hashSecret(secret), hashSecret(secret));
});

test("secretMatchesHash accepts the correct secret", () => {
  const secret = generateSecret();
  assert.equal(secretMatchesHash(secret, hashSecret(secret)), true);
});

test("secretMatchesHash rejects an incorrect secret", () => {
  const secret = generateSecret();
  const other = generateSecret();
  assert.equal(secretMatchesHash(other, hashSecret(secret)), false);
});

test("secretMatchesHash rejects a malformed stored hash", () => {
  assert.equal(secretMatchesHash("anything", "not-a-valid-hash"), false);
});
