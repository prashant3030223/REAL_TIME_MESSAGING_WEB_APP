import test from "node:test";
import assert from "node:assert/strict";
import { canForwardMessage } from "../../apps/web/src/services/forwarding.js";

test("forwarding rejects deleted, expired, malformed-expiry, and unsent messages", () => {
  const now = Date.parse("2026-11-27T12:00:00.000Z");
  assert.equal(canForwardMessage({ status: "read" }, now), true);
  assert.equal(canForwardMessage({ status: "sent", expiresAt: "2026-11-27T12:01:00.000Z" }, now), true);
  assert.equal(canForwardMessage({ status: "read", isDeleted: true }, now), false);
  assert.equal(canForwardMessage({ status: "read", expiresAt: "2026-11-27T11:59:59.000Z" }, now), false);
  assert.equal(canForwardMessage({ status: "read", expiresAt: "not-a-date" }, now), false);
  assert.equal(canForwardMessage({ status: "scheduled" }, now), false);
  assert.equal(canForwardMessage({ status: "pending" }, now), false);
  assert.equal(canForwardMessage({ status: "failed" }, now), false);
});
