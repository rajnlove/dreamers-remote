import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMagicPacket } from "./wol.js";

test("buildMagicPacket is 102 bytes starting with six 0xFF bytes", () => {
  const packet = buildMagicPacket("AA:BB:CC:DD:EE:FF");
  assert.equal(packet.length, 102);
  for (let i = 0; i < 6; i++) {
    assert.equal(packet[i], 0xff);
  }
});

test("buildMagicPacket repeats the MAC address 16 times", () => {
  const packet = buildMagicPacket("AA:BB:CC:DD:EE:FF");
  const macBytes = [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff];
  for (let rep = 0; rep < 16; rep++) {
    const offset = 6 + rep * 6;
    for (let i = 0; i < 6; i++) {
      assert.equal(packet[offset + i], macBytes[i]);
    }
  }
});

test("buildMagicPacket accepts hyphen-separated MAC addresses", () => {
  const packet = buildMagicPacket("AA-BB-CC-DD-EE-FF");
  assert.equal(packet.length, 102);
  assert.equal(packet[6], 0xaa);
});

test("buildMagicPacket rejects a malformed MAC address", () => {
  assert.throws(() => buildMagicPacket("not-a-mac"));
});
