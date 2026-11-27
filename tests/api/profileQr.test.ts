import test from "node:test";
import assert from "node:assert/strict";
import {
  createProfileQrLink,
  getConnectUsername,
  normalizeProfileQrUsername,
} from "../../apps/web/src/services/profileQr.js";

test("profile QR links point to the app root with a connect username", () => {
  assert.equal(
    createProfileQrLink("@Alex_1", "https://connectsphere.example"),
    "https://connectsphere.example/?connect=alex_1",
  );
});

test("profile QR scanner accepts profile links and usernames only", () => {
  const origin = "https://connectsphere.example";
  assert.equal(getConnectUsername("https://connectsphere.example/?connect=Alex", origin), "alex");
  assert.equal(getConnectUsername("https://connectsphere.example/u/Alex", origin), "alex");
  assert.equal(getConnectUsername("@Alex", origin), "alex");
  assert.equal(getConnectUsername("https://another-site.example/?connect=alex", origin), null);
  assert.equal(getConnectUsername("https://connectsphere.example/?connect=invalid-name", origin), null);
});

test("profile QR usernames must satisfy ConnectSphere username limits", () => {
  assert.equal(normalizeProfileQrUsername("  @Some_User  "), "some_user");
  assert.equal(normalizeProfileQrUsername("ab"), null);
  assert.throws(() => createProfileQrLink("invalid-name", "https://connectsphere.example"));
});
