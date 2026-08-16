import assert from "node:assert/strict";
import { test } from "node:test";
import { ValidationError } from "./errors.js";
import { isValidIPv4, isValidMacAddress, isValidPort, validateCreateInput, validateUpdateInput } from "./validation.js";

test("isValidIPv4 accepts valid addresses", () => {
  assert.equal(isValidIPv4("192.29.11.94"), true);
  assert.equal(isValidIPv4("0.0.0.0"), true);
  assert.equal(isValidIPv4("255.255.255.255"), true);
});

test("isValidIPv4 rejects invalid addresses", () => {
  assert.equal(isValidIPv4("256.1.1.1"), false);
  assert.equal(isValidIPv4("192.29.11"), false);
  assert.equal(isValidIPv4("not-an-ip"), false);
  assert.equal(isValidIPv4("192.29.11.94.1"), false);
});

test("isValidMacAddress accepts colon-separated hex pairs", () => {
  assert.equal(isValidMacAddress("AA:BB:CC:DD:EE:FF"), true);
  assert.equal(isValidMacAddress("aa:bb:cc:dd:ee:ff"), true);
});

test("isValidMacAddress rejects malformed input", () => {
  assert.equal(isValidMacAddress("AA-BB-CC-DD-EE-FF"), false);
  assert.equal(isValidMacAddress("AABBCCDDEEFF"), false);
  assert.equal(isValidMacAddress("AA:BB:CC:DD:EE"), false);
});

test("isValidPort enforces the 1-65535 integer range", () => {
  assert.equal(isValidPort(5900), true);
  assert.equal(isValidPort(1), true);
  assert.equal(isValidPort(65535), true);
  assert.equal(isValidPort(0), false);
  assert.equal(isValidPort(65536), false);
  assert.equal(isValidPort(1.5), false);
});

test("validateCreateInput accepts a well-formed workstation and applies defaults", () => {
  const result = validateCreateInput({
    name: "COMP-01",
    hostname: "COMP-01",
    ip: "192.29.11.95",
    mac_address: "AA:BB:CC:DD:EE:FF",
  });
  assert.equal(result.vnc_port, 5900);
  assert.equal(result.enabled, true);
  assert.equal(result.jobs_enabled, true);
  assert.equal(result.location, null);
});

test("validateCreateInput rejects missing required fields", () => {
  assert.throws(() => validateCreateInput({ name: "COMP-01" }), ValidationError);
});

test("validateCreateInput rejects an invalid IP", () => {
  assert.throws(
    () => validateCreateInput({ name: "x", hostname: "x", ip: "bad", mac_address: "AA:BB:CC:DD:EE:FF" }),
    ValidationError,
  );
});

test("validateCreateInput rejects an invalid MAC address", () => {
  assert.throws(
    () => validateCreateInput({ name: "x", hostname: "x", ip: "192.29.11.95", mac_address: "not-a-mac" }),
    ValidationError,
  );
});

test("validateCreateInput rejects an out-of-range vnc_port", () => {
  assert.throws(
    () =>
      validateCreateInput({
        name: "x",
        hostname: "x",
        ip: "192.29.11.95",
        mac_address: "AA:BB:CC:DD:EE:FF",
        vnc_port: 99999,
      }),
    ValidationError,
  );
});

test("validateUpdateInput requires at least one field", () => {
  assert.throws(() => validateUpdateInput({}), ValidationError);
});

test("validateUpdateInput accepts a partial update", () => {
  const result = validateUpdateInput({ enabled: false });
  assert.deepEqual(result, { enabled: false });
});

test("validateUpdateInput rejects an invalid field even when partial", () => {
  assert.throws(() => validateUpdateInput({ ip: "not-an-ip" }), ValidationError);
});
