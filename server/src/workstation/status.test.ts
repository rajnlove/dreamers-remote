import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import { checkTcpPort } from "./status.js";

test("checkTcpPort resolves true for an open port", async () => {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected server to listen on a TCP port");
  }

  try {
    const online = await checkTcpPort("127.0.0.1", address.port, 500);
    assert.equal(online, true);
  } finally {
    server.close();
  }
});

test("checkTcpPort resolves false for a closed port", async () => {
  // Port 1 (tcpmux) is essentially never listening in a test environment,
  // so the OS refuses the connection almost immediately.
  const online = await checkTcpPort("127.0.0.1", 1, 300);
  assert.equal(online, false);
});

test("checkTcpPort resolves false when the timeout elapses", async () => {
  // 10.255.255.1 is unroutable in practice for a typical test environment,
  // so the connection attempt neither succeeds nor is refused before the
  // short timeout — exercising the timeout branch specifically.
  const online = await checkTcpPort("10.255.255.1", 5900, 300);
  assert.equal(online, false);
});
