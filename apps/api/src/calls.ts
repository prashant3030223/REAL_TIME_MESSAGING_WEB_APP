import { createHmac, randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { ApiError } from "./errors.js";
import type { AppLogger } from "./logger.js";
import { resolveSessionUserId, SESSION_COOKIE_NAME } from "./auth.js";

const LogCallSchema = z.object({
  peerName: z.string().min(1).max(100),
  type: z.enum(["voice", "video"]),
  direction: z.enum(["incoming", "outgoing", "missed", "declined"]),
  durationSeconds: z.number().int().nonnegative(),
});

const SignalingSchema = z.object({
  type: z.enum(["offer", "answer", "ice-candidate", "quality-update", "hangup"]),
  peerId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const TurnixIceConfigSchema = z.object({
  iceServers: z.array(z.object({
    urls: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    username: z.string().optional(),
    credential: z.string().optional(),
  })).min(1),
  expiresAt: z.string().datetime(),
});

function sanitizeTurnixLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const label = value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128);
  return label || undefined;
}

export function createCallsRouter(database: Pool | undefined, logger: AppLogger) {
  const router = Router();
  const inMemoryCalls: Array<{
    id: string;
    peerName: string;
    type: string;
    direction: string;
    durationSeconds: number;
    createdAt: string;
  }> = [];

  // ICE servers are required for WebRTC connections across networks.
  // Defaults provide public STUN; TURN credentials can be supplied in production.
  router.get("/ice-servers", async (request, response) => {
    const stunUrls = (process.env.STUN_URLS || process.env.WEBRTC_STUN_SERVERS || "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302")
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean);
    const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
      { urls: stunUrls },
    ];

    const turnixToken = process.env.TURNIX_API_TOKEN?.trim();
    if (turnixToken) {
      const userId = await resolveSessionUserId(database, request.cookies?.[SESSION_COOKIE_NAME]);
      if (!userId) {
        throw new ApiError(401, "UNAUTHENTICATED", "Sign in to get call relay credentials.");
      }
      const room = sanitizeTurnixLabel(request.query["callId"]);
      const initiatorClient = sanitizeTurnixLabel(userId);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      let turnixResponse: Response;
      let providerBody: unknown;
      try {
        turnixResponse = await fetch("https://turnix.io/api/v1/credentials/ice", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${turnixToken}`,
            "Content-Type": "application/json",
            ...(request.ip ? { "X-TURN-CLIENT-IP": request.ip } : {}),
          },
          body: JSON.stringify({
            ttl: 3600,
            ...(room ? { room } : {}),
            ...(initiatorClient ? { initiator_client: initiatorClient } : {}),
          }),
          signal: controller.signal,
        });
        if (turnixResponse.ok) providerBody = await turnixResponse.json();
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "AbortError";
        const invalidJson = error instanceof SyntaxError;
        logger.error({
          errorName: error instanceof Error ? error.name : "UnknownError",
        }, timedOut
          ? "TURN credential provider timed out"
          : invalidJson
            ? "TURN credential provider returned invalid JSON"
            : "Could not reach TURN credential provider");
        throw new ApiError(
          timedOut ? 504 : 502,
          timedOut ? "TURN_PROVIDER_TIMEOUT" : invalidJson ? "TURN_PROVIDER_RESPONSE" : "TURN_PROVIDER_UNAVAILABLE",
          timedOut
            ? "Call relay credentials timed out. Try again."
            : invalidJson
              ? "Call relay provider returned an invalid response."
              : "Could not load call relay credentials.",
        );
      } finally {
        clearTimeout(timeout);
      }

      if (turnixResponse.status === 401) {
        logger.error({ statusCode: turnixResponse.status }, "TURN credential provider rejected its configured API token");
        throw new ApiError(502, "TURN_PROVIDER_AUTH", "The call relay provider rejected its API token.");
      }
      if (turnixResponse.status === 429) {
        logger.warn({ statusCode: turnixResponse.status }, "TURN credential provider usage limit reached");
        throw new ApiError(503, "TURN_USAGE_LIMIT", "Call relay usage limit reached. Try again later.");
      }
      if (!turnixResponse.ok) {
        logger.error({ statusCode: turnixResponse.status }, "TURN credential provider returned an error");
        throw new ApiError(502, "TURN_PROVIDER_ERROR", "Could not load call relay credentials.");
      }

      const parsedTurnixResponse = TurnixIceConfigSchema.safeParse(providerBody);
      if (!parsedTurnixResponse.success) {
        logger.error({ statusCode: turnixResponse.status }, "TURN credential provider returned invalid ICE settings");
        throw new ApiError(502, "TURN_PROVIDER_RESPONSE", "Call relay provider returned invalid ICE settings.");
      }

      response.status(200).json({
        iceServers: parsedTurnixResponse.data.iceServers,
        expiresAt: parsedTurnixResponse.data.expiresAt,
      });
      return;
    }

    const turnUrl = (process.env.TURN_URL || process.env.WEBRTC_TURN_SERVERS)?.trim();
    if (!turnUrl) {
      logger.error({}, "TURNIX_API_TOKEN is missing and no self-hosted TURN relay is configured");
      throw new ApiError(500, "TURN_CONFIGURATION", "Configure TURNIX_API_TOKEN or a self-hosted TURN relay.");
    }
    if (turnUrl) {
      const turnUrls = turnUrl.split(",").map((url) => url.trim()).filter(Boolean);
      if (turnUrls.length === 0) {
        throw new ApiError(503, "TURN_CONFIGURATION", "TURN server URLs are not configured.");
      }
      const userId = await resolveSessionUserId(database, request.cookies?.[SESSION_COOKIE_NAME]);
      if (!userId) {
        throw new ApiError(401, "UNAUTHENTICATED", "Sign in to get call relay credentials.");
      }

      const sharedSecret = process.env.TURN_SHARED_SECRET?.trim();
      let username: string | undefined;
      let credential: string | undefined;
      if (sharedSecret) {
        username = `${Math.floor(Date.now() / 1000) + 10 * 60}:${userId}`;
        credential = createHmac("sha1", sharedSecret).update(username).digest("base64");
      } else {
        username = (process.env.TURN_USERNAME || process.env.WEBRTC_TURN_USERNAME)?.trim();
        credential = (process.env.TURN_CREDENTIAL || process.env.WEBRTC_TURN_CREDENTIAL)?.trim();
        if (!username || !credential) {
          throw new ApiError(503, "TURN_CONFIGURATION", "TURN credentials are not configured.");
        }
      }

      iceServers.push({ urls: turnUrls, username, credential });
    }

    response.status(200).json({ iceServers });
  });

  // GET /api/calls - list call history
  router.get("/", async (_request, response, next) => {
    if (database) {
      try {
        const result = await database.query(
          "SELECT id, peer_name, type, direction, duration_seconds, created_at FROM app_calls ORDER BY created_at DESC LIMIT 50"
        );
        response.status(200).json({ calls: result.rows });
        return;
      } catch (error) {
        logger.error({ errorName: error instanceof Error ? error.name : "Unknown" }, "Failed to fetch calls");
        next(new ApiError(500, "DATABASE_ERROR", "Could not load call history."));
        return;
      }
    }

    response.status(200).json({ calls: inMemoryCalls });
  });

  // POST /api/calls - log completed or missed call
  router.post("/", (request, response, next) => {
    const parseResult = LogCallSchema.safeParse(request.body);
    if (!parseResult.success) {
      next(new ApiError(400, "INVALID_CALL_RECORD", "Valid call fields are required."));
      return;
    }

    const { peerName, type, direction, durationSeconds } = parseResult.data;
    const callRecord = {
      id: randomUUID(),
      peerName,
      type,
      direction,
      durationSeconds,
      createdAt: new Date().toISOString(),
    };

    inMemoryCalls.unshift(callRecord);
    logger.info({ callId: callRecord.id, peerName, type, direction }, "Call record logged");
    response.status(201).json({ call: callRecord });
  });

  // POST /api/calls/signaling - WebRTC peer signaling exchange
  router.post("/signaling", (request, response, next) => {
    const parseResult = SignalingSchema.safeParse(request.body);
    if (!parseResult.success) {
      next(new ApiError(400, "INVALID_SIGNALING_PAYLOAD", "Signaling message type and peerId are required."));
      return;
    }

    const { type, peerId, payload } = parseResult.data;
    logger.info({ signalingType: type, peerId }, "WebRTC signaling event processed");

    response.status(200).json({
      status: "acknowledged",
      type,
      peerId,
      receivedAt: new Date().toISOString(),
      relayed: true,
      echo: payload ?? {},
    });
  });

  return router;
}
