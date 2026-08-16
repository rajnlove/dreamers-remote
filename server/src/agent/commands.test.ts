import assert from "node:assert/strict";
import { test } from "node:test";
import { isAgentCommand } from "./commands.js";

test("isAgentCommand accepts the whitelisted commands", () => {
  assert.equal(isAgentCommand("restart"), true);
  assert.equal(isAgentCommand("shutdown"), true);
});

test("isAgentCommand rejects anything else", () => {
  assert.equal(isAgentCommand("rm -rf /"), false);
  assert.equal(isAgentCommand(""), false);
  assert.equal(isAgentCommand(undefined), false);
  assert.equal(isAgentCommand(123), false);
});
