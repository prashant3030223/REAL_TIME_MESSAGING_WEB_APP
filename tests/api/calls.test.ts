import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import pino from "pino";
import { createApp } from "../../apps/api/src/app.js";
import { SESSION_COOKIE_NAME } from "../../apps/api/src/auth.js";

test("TURN ICE settings require sign-in and return short-lived credentials", async () => {
  const envKeys = ["TURN_URL", "TURN_SHARED_SECRET", "TURNIX_API_TOKEN"] as const;
  const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  const sharedSecret = "test-shared-turn-secret";
  delete process.env.TURNIX_API_TOKEN;
  process.env.TURN_URL = "turn:relay.example.test:3478?transport=udp";
  process.env.TURN_SHARED_SECRET = sharedSecret;

  const database = {
    query: async () => ({ rows: [{ user_id: "user-123" }] }),
  } as unknown as Pool;
  const app = createApp({ logger: pino({ enabled: false }), database });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${address.port}/api/calls/ice-servers`;

  try {
    const unauthenticated = await fetch(endpoint);
    assert.equal(unauthenticated.status, 401);

    const response = await fetch(endpoint, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${"A".repeat(43)}` },
    });
    assert.equal(response.status, 200);
    const result = await response.json() as { iceServers: RTCIceServer[] };
    const turnServer = result.iceServers.find((server) =>
      (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) => url.startsWith("turn:"))
    );
    assert.ok(turnServer);
    assert.equal(turnServer.urls instanceof Array ? turnServer.urls[0] : turnServer.urls,
      "turn:relay.example.test:3478?transport=udp");
    assert.match(turnServer.username ?? "", /^\d+:user-123$/);
    assert.equal(
      turnServer.credential,
      createHmac("sha1", sharedSecret).update(turnServer.username ?? "").digest("base64"),
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Turnix credentials are requested server-side with the authenticated client IP", async () => {
  const envKeys = ["TURNIX_API_TOKEN", "TURN_URL", "TURN_SHARED_SECRET", "WEBRTC_TURN_SERVERS"] as const;
  const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  const apiToken = "turnix-test-api-token";
  process.env.TURNIX_API_TOKEN = apiToken;
  delete process.env.TURN_URL;
  delete process.env.TURN_SHARED_SECRET;
  delete process.env.WEBRTC_TURN_SERVERS;

  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedAuthorization: string | null = null;
  let capturedClientIp: string | null = null;
  let capturedBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    const headers = new Headers(init?.headers);
    capturedAuthorization = headers.get("authorization");
    capturedClientIp = headers.get("x-turn-client-ip");
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      iceServers: [
        { urls: ["stun:stun.turnix.io:3478"] },
        {
          urls: ["turn:us-west.turnix.io:3478?transport=udp"],
          username: "temporary-turn-user",
          credential: "temporary-turn-credential",
        },
      ],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      privateMetadata: "must not be forwarded",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const database = {
    query: async () => ({ rows: [{ user_id: "caller-123" }] }),
  } as unknown as Pool;
  const app = createApp({ logger: pino({ enabled: false }), database, trustProxy: 1 });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${address.port}/api/calls/ice-servers?callId=call%3Aroom-1`;

  try {
    const response = await originalFetch(endpoint, {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${"B".repeat(43)}`,
        "x-forwarded-for": "198.51.100.27",
      },
    });
    assert.equal(response.status, 200);
    const result = await response.json() as {
      iceServers: RTCIceServer[];
      expiresAt: string;
      privateMetadata?: string;
    };
    assert.equal(capturedUrl, "https://turnix.io/api/v1/credentials/ice");
    assert.equal(capturedAuthorization, `Bearer ${apiToken}`);
    assert.equal(capturedClientIp, "198.51.100.27");
    assert.deepEqual(capturedBody, {
      ttl: 3600,
      room: "callroom-1",
      initiator_client: "caller-123",
    });
    assert.equal(result.iceServers.length, 2);
    assert.ok(result.expiresAt);
    assert.equal(result.privateMetadata, undefined);
    assert.equal(JSON.stringify(result).includes(apiToken), false);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
