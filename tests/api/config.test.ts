import test from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../../apps/api/src/config.js";
import { normalizePhoneNumber } from "../../apps/api/src/sms.js";

test("uses safe development defaults and does not require the database for startup", () => {
  assert.deepEqual(parseConfig({}), {
    nodeEnv: "development",
    port: 3001,
    logLevel: "info",
  });
});

test("parses explicit settings", () => {
  assert.deepEqual(parseConfig({
    NODE_ENV: "test",
    PORT: "4100",
    LOG_LEVEL: "debug",
    DATABASE_URL: "postgresql://localhost/app",
  }), {
    nodeEnv: "test",
    port: 4100,
    logLevel: "debug",
    databaseUrl: "postgresql://localhost/app",
  });
});

test("rejects malformed configuration with field-level detail", () => {
  assert.throws(() => parseConfig({ PORT: "invalid" }), /PORT/);
  assert.throws(() => parseConfig({ NODE_ENV: "preview" }), /NODE_ENV/);
  assert.throws(() => parseConfig({ NODE_ENV: "production" }), /DATABASE_URL is required in production/);
  assert.throws(() => parseConfig({ VAPID_PUBLIC_KEY: "public-only" }), /VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY/);
});

test("parses production and networking settings", () => {
  const config = parseConfig({
    NODE_ENV: "production",
    PORT: "8080",
    DATABASE_URL: "postgresql://rds.example.com/prod",
    DATABASE_SSL: "TRUE",
    DATABASE_MAX_CONNECTIONS: "25",
    CORS_ORIGIN: "https://connectsphere.com",
    TRUST_PROXY: "FALSE",
  });

  test("parses the browser push configuration", () => {
    assert.deepEqual(parseConfig({
      VAPID_PUBLIC_KEY: "public-key",
      VAPID_PRIVATE_KEY: "private-key",
      VAPID_SUBJECT: "mailto:ops@connectsphere.io",
    }), {
      nodeEnv: "development",
      port: 3001,
      logLevel: "info",
      webPushPublicKey: "public-key",
      webPushPrivateKey: "private-key",
      webPushSubject: "mailto:ops@connectsphere.io",
    });
  });

  assert.deepEqual(config, {
    nodeEnv: "production",
    port: 8080,
    logLevel: "info",
    databaseUrl: "postgresql://rds.example.com/prod",
    databaseSsl: true,
    databaseMaxConnections: 25,
    corsOrigin: "https://connectsphere.com",
    trustProxy: false,
  });
});

test("normalizes common international and domestic phone formats", () => {
  assert.equal(normalizePhoneNumber("+1 (415) 555-0100"), "14155550100");
  assert.equal(normalizePhoneNumber("+91 98765 43210"), "9876543210");
  assert.equal(normalizePhoneNumber("020 1234 5678"), "2012345678");
});