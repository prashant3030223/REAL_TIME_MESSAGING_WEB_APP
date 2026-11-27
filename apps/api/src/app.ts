import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { createAuthRouter } from "./auth.js";
import { createTelemetryRouter } from "./telemetry.js";
import { createConversationsRouter } from "./conversations.js";
import { createCallsRouter } from "./calls.js";
import { createConnectionsRouter } from "./connections.js";
import type { Pool } from "pg";
import { ApiError, createErrorHandler } from "./errors.js";
import type { AppLogger } from "./logger.js";
import type { R2AttachmentStorage } from "./objectStorage.js";
import type { ScheduledMessagePayload } from "./scheduledMessages.js";
import { createPushRouter } from "./push.js";
import type { PushNotificationPayload } from "./push.js";

export type AppDependencies = {
  logger: AppLogger;
  database?: Pool;
  notifyReadReceipt?: (conversationId: string, readerId: string, messageIds: string[]) => Promise<void>;
  notifyScheduledMessage?: (message: ScheduledMessagePayload) => Promise<void>;
  notifyMessageDeleted?: (payload: {
    messageId: string;
    conversationId: string;
    deletedBy: string;
    ghostUnsend?: boolean;
  }) => Promise<void>;
  notifyPushToUser?: (userId: string, payload: PushNotificationPayload) => Promise<void>;
  pushDelivery?: { isConfigured: boolean; publicKey: string | null };
  secureCookies?: boolean;
  staticDir?: string;
  corsOrigin?: string;
  trustProxy?: boolean | number | string;
  attachmentStorage?: R2AttachmentStorage;
};

export function createApp({
  logger,
  database,
  notifyReadReceipt,
  notifyScheduledMessage,
  notifyMessageDeleted,
  notifyPushToUser,
  pushDelivery = { isConfigured: false, publicKey: null },
  secureCookies = false,
  staticDir,
  corsOrigin,
  trustProxy,
  attachmentStorage,
}: AppDependencies) {
  const app = express();
  app.disable("x-powered-by");

  if (trustProxy) {
    app.set("trust proxy", trustProxy === true ? 1 : trustProxy);
  }

  // Security headers with production SPA-friendly CSP
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:", "https://images.unsplash.com"],
          connectSrc: ["'self'", "ws:", "wss:"],
          fontSrc: ["'self'", "data:"],
          mediaSrc: ["'self'", "blob:", "data:"],
          objectSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  // Configurable CORS support
  if (corsOrigin) {
    const origins = corsOrigin.split(",").map((o) => o.trim()).filter(Boolean);
    const allowAnyOrigin = origins.includes("*");
    app.use((request, response, next) => {
      const origin = request.headers.origin;
      if (allowAnyOrigin) {
        response.setHeader("Access-Control-Allow-Origin", "*");
      } else if (origin && origins.includes(origin)) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Access-Control-Allow-Credentials", "true");
        response.setHeader("Vary", "Origin");
      }
      if (origin && (allowAnyOrigin || origins.includes(origin))) {
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-request-id");
      }
      if (request.method === "OPTIONS") {
        response.status(204).end();
        return;
      }
      next();
    });
  }

  app.use((request, response, next) => {
    const requestId = randomUUID();
    response.locals.requestId = requestId;
    response.setHeader("x-request-id", requestId);
    const startedAt = performance.now();
    response.on("finish", () => {
      logger.info({
        requestId,
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      }, "HTTP request");
    });
    next();
  });
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());

  app.get("/api/health/live", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.get("/api/health/ready", async (_request, response) => {
    if (!database) {
      response.status(503).json({
        status: "not_ready",
        dependencies: { database: "not_configured" },
      });
      return;
    }

    try {
      await database.query("SELECT 1");
    } catch (error) {
      logger.warn({
        requestId: response.locals.requestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "Readiness check failed");
      response.status(503).json({
        status: "not_ready",
        dependencies: { database: "unavailable" },
      });
      return;
    }

    response.status(200).json({
      status: "ready",
      dependencies: { database: "available" },
    });
  });

  app.use("/api/auth", (request, _response, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && !request.is("application/json")) {
      next(new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Account requests must use application/json."));
      return;
    }
    next();
  });
  app.use("/api/auth", createAuthRouter(database, logger, secureCookies));
  app.use("/api/telemetry", createTelemetryRouter(logger));
  app.use(
    "/api/conversations",
    createConversationsRouter(
      database,
      logger,
      notifyReadReceipt,
      notifyScheduledMessage,
      attachmentStorage,
      notifyMessageDeleted,
      notifyPushToUser,
    ),
  );
  app.use("/api/calls", createCallsRouter(database, logger));
  app.use("/api/connections", createConnectionsRouter(database, logger));
  app.use("/api/push", createPushRouter(database, logger, pushDelivery));

  // Static frontend serving and Single Page Application fallback for production
  if (staticDir && existsSync(staticDir)) {
    const assetsDir = path.join(staticDir, "assets");
    if (existsSync(assetsDir)) {
      app.use("/assets", express.static(assetsDir, { maxAge: "1y", immutable: true }));
    }
    app.use(express.static(staticDir, { maxAge: "1h", index: false }));

    app.use((request, response, next) => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return next();
      }
      if (request.path.startsWith("/api")) {
        return next();
      }
      const indexPath = path.join(staticDir, "index.html");
      if (existsSync(indexPath)) {
        response.setHeader("Cache-Control", "no-cache");
        response.sendFile(indexPath);
      } else {
        next();
      }
    });
  }

  app.use("/api", (request, _response, next) => {
    const path = request.originalUrl.split("?")[0] ?? request.path;
    next(new ApiError(404, "NOT_FOUND", `No route for ${request.method} ${path}.`));
  });
  app.use((_request, _response, next) => {
    next(new ApiError(404, "NOT_FOUND", "Route not found."));
  });
  app.use(createErrorHandler(logger));

  return app;
}
