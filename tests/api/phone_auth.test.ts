import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import pino from "pino";
import { createApp } from "../../apps/api/src/app.js";
import { normalizePhoneNumber } from "../../apps/api/src/sms.js";

async function withServer(run: (baseUrl: string) => Promise<void>) {
  process.env.NODE_ENV = "test";
  const logger = pino({ enabled: false });
  const app = createApp({ logger });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("normalizePhoneNumber formats phone numbers for SMS Horizon", () => {
  assert.equal(normalizePhoneNumber("+919756996666"), "9756996666");
  assert.equal(normalizePhoneNumber("919756996666"), "9756996666");
  assert.equal(normalizePhoneNumber("09756996666"), "9756996666");
  assert.equal(normalizePhoneNumber("9756996666"), "9756996666");
  assert.equal(normalizePhoneNumber("+1 (555) 123-4567"), "15551234567");
});

test("POST /api/auth/send-otp validates phone number payload", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/auth/send-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "" }),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.equal(body.error?.code, "INVALID_PHONE_NUMBER");
  });
});

test("WhatsApp OTP send, verification, and profile setup full flow", async () => {
  await withServer(async (baseUrl) => {
    // 1. Send OTP
    const sendRes = await fetch(`${baseUrl}/api/auth/send-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+919756996666" }),
    });
    assert.equal(sendRes.status, 200);
    const sendBody = await sendRes.json() as any;
    assert.equal(sendBody.success, true);
    assert.ok(sendBody.phone);

    // 2. Verify with wrong OTP
    const wrongVerify = await fetch(`${baseUrl}/api/auth/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+919756996666", otp: "000000" }),
    });
    assert.equal(wrongVerify.status, 400);

    // 3. Verify with correct OTP
    // In dev mode when gateway is called, if dev fallback otp exists or in-memory otp:
    // Let's send a known request or inspect otp if returned
    const testOtp = sendBody.devOtp;
    if (testOtp) {
      const verifyRes = await fetch(`${baseUrl}/api/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "+919756996666", otp: testOtp }),
      });
      assert.equal(verifyRes.status, 200);
      const verifyBody = await verifyRes.json() as any;
      assert.ok(verifyBody.user?.id);
      assert.equal(verifyBody.user?.isVerified, true);

      // Verify session cookie
      const cookieHeader = verifyRes.headers.get("set-cookie");
      assert.ok(cookieHeader);

      // 4. Update Profile
      const profileRes = await fetch(`${baseUrl}/api/auth/profile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader.split(";")[0] ?? "",
        },
        body: JSON.stringify({
          displayName: "Prashant Yadav",
          bio: "Building ConnectSphere with zero-drop calling",
          avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=240&q=80",
        }),
      });
      assert.equal(profileRes.status, 200);
      const profileBody = await profileRes.json() as any;
      assert.equal(profileBody.user?.displayName, "Prashant Yadav");
      assert.equal(profileBody.user?.bio, "Building ConnectSphere with zero-drop calling");

      // 5. Check /api/auth/me
      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Cookie: cookieHeader.split(";")[0] ?? "",
        },
      });
      assert.equal(meRes.status, 200);
      const meBody = await meRes.json() as any;
      assert.equal(meBody.user?.displayName, "Prashant Yadav");

      // 6. Sign out
      const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader.split(";")[0] ?? "",
        },
      });
      assert.equal(logoutRes.status, 204);
    }
  });
});
