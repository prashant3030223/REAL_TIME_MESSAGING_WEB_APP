import test from "node:test";
import assert from "node:assert/strict";
import {
  generatePasswordResetEmailHtml,
  getBrevoConfiguration,
  sendPasswordResetEmail,
} from "../../apps/api/src/brevo.js";

test("generatePasswordResetEmailHtml produces responsive HTML containing user and code", () => {
  const html = generatePasswordResetEmailHtml("Prashant", "789123");

  assert.ok(html.includes("Prashant"), "Email HTML should include recipient name");
  assert.ok(html.includes("789123"), "Email HTML should include reset code");
  assert.ok(html.includes("15 minutes"), "Email HTML should state 15 minutes expiration");
  assert.ok(html.includes("ConnectSphere"), "Email HTML should include brand name");
  assert.ok(html.includes("<!DOCTYPE html>"), "Email HTML should be valid HTML document");
});

test("getBrevoConfiguration returns defaults for sender name and email", () => {
  const config = getBrevoConfiguration();
  assert.ok(config.senderName.length > 0, "Sender name should have a default value");
  assert.ok(config.senderEmail.includes("@"), "Sender email should be valid format");
});

test("sendPasswordResetEmail succeeds in test mode without calling external network", async () => {
  const result = await sendPasswordResetEmail({
    toEmail: "test@example.com",
    recipientName: "Test User",
    resetCode: "654321",
  });

  assert.equal(result.success, true);
  assert.equal(result.devCode, "654321");
});
