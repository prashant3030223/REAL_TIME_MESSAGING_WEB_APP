import "dotenv/config";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { createApp } from "./app.js";
import { parseConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createRealtimeGateway } from "./realtime.js";
import { createScheduledMessageScheduler } from "./scheduledMessages.js";
import { createMessageExpiryScheduler } from "./messageExpiry.js";
import { createR2AttachmentStorage } from "./objectStorage.js";
import { createPushDelivery } from "./push.js";
import { applyDatabaseMigrations } from "./db/migrate.js";

const config = parseConfig(process.env);
const logger = createLogger(config);

const database = config.databaseUrl
  ? new Pool({
    connectionString: config.databaseUrl,
    max: config.databaseMaxConnections ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...(config.databaseSsl ? { ssl: { rejectUnauthorized: true } } : {}),
  })
  : undefined;

database?.on("error", (error) => {
  logger.error({
    errorName: error instanceof Error ? error.name : "UnknownError",
  }, "Idle PostgreSQL connection failed");
});

if (database) {
  await applyDatabaseMigrations(database);
}

const defaultStaticDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
const cwdStaticDir = resolve(process.cwd(), "apps/web/dist");
const staticDir =
  config.staticDir ??
  (existsSync(cwdStaticDir)
    ? cwdStaticDir
    : existsSync(defaultStaticDir)
      ? defaultStaticDir
      : undefined);

const server = createServer();
const attachmentStorage = createR2AttachmentStorage();
const pushDelivery = createPushDelivery(database, logger, config);
const notifyPushToUser = pushDelivery.isConfigured ? pushDelivery.sendToUser : undefined;
const realtimeGateway = createRealtimeGateway(
  server,
  logger,
  database,
  attachmentStorage,
  notifyPushToUser,
);
const scheduledMessageScheduler = database
  ? createScheduledMessageScheduler(database, realtimeGateway.broadcastScheduledMessage, logger)
  : undefined;
const messageExpiryScheduler = database
  ? createMessageExpiryScheduler(database, attachmentStorage, logger)
  : undefined;

const app = createApp({
  logger,
  secureCookies: config.nodeEnv === "production",
  attachmentStorage,
  ...(database ? { database } : {}),
  notifyReadReceipt: realtimeGateway.broadcastReadReceipt,
  notifyScheduledMessage: realtimeGateway.broadcastScheduledMessage,
  notifyMessageDeleted: realtimeGateway.broadcastMessageDeleted,
  ...(notifyPushToUser ? { notifyPushToUser } : {}),
  pushDelivery,
  ...(staticDir ? { staticDir } : {}),
  ...(config.corsOrigin ? { corsOrigin: config.corsOrigin } : {}),
  ...(config.trustProxy !== undefined ? { trustProxy: config.trustProxy } : {}),
});
server.on("request", app);

server.listen(config.port, "0.0.0.0", () => {
  logger.info({
    port: config.port,
    env: config.nodeEnv,
    databaseConfigured: Boolean(database),
    staticServing: Boolean(staticDir),
    realtimeActive: true,
  }, "API & Realtime WebSocket server listening");
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Graceful shutdown started");

  const forceTimeout = setTimeout(() => {
    logger.error("Forced process exit after shutdown timeout");
    process.exit(1);
  }, 10_000);
  forceTimeout.unref();

  await scheduledMessageScheduler?.shutdown();
  await messageExpiryScheduler?.shutdown();
  realtimeGateway.shutdown();
  server.closeIdleConnections?.();
  await new Promise<void>((resolve) => {
    server.close((error) => {
      if (error) {
        logger.error({ errorName: error.name }, "HTTP server shutdown failed");
        process.exitCode = 1;
      }
      resolve();
    });
  });

  if (database) {
    try {
      await database.end();
    } catch (error) {
      logger.error({
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "Database pool shutdown failed");
      process.exitCode = 1;
    }
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
