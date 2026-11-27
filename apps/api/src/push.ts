import { Router } from "express";
import type { Request } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { sendNotification, setVapidDetails, WebPushError } from "web-push";
import { ApiError } from "./errors.js";
import type { AppConfig } from "./config.js";
import { resolveSessionUserId, SESSION_COOKIE_NAME } from "./auth.js";
import type { AppLogger } from "./logger.js";

export type PushNotificationPayload = {
  type: "message" | "call" | "call-ended";
  title: string;
  body: string;
  url?: string;
  conversationId?: string;
  callId?: string;
  isVideo?: boolean;
  tag?: string;
};

type StoredSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(4096).refine((value) => {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      const supportedHost =
        host === "fcm.googleapis.com" ||
        host === "android.googleapis.com" ||
        host.endsWith(".push.apple.com") ||
        host.endsWith(".push.services.mozilla.com") ||
        host === "notify.windows.com" ||
        host.endsWith(".notify.windows.com");
      return url.protocol === "https:" && !url.username && !url.password &&
        (!url.port || url.port === "443") && supportedHost;
    } catch {
      return false;
    }
  }, "Unsupported push service endpoint."),
  keys: z.object({
    p256dh: z.string().min(20).max(256),
    auth: z.string().min(10).max(128),
  }).strict(),
}).strict();

export function createPushDelivery(
  database: Pool | undefined,
  logger: AppLogger,
  config: AppConfig,
) {
  const { webPushPublicKey, webPushPrivateKey } = config;
  const isConfigured = Boolean(database && webPushPublicKey && webPushPrivateKey);

  if (database && webPushPublicKey && webPushPrivateKey) {
    setVapidDetails(
      config.webPushSubject ?? "mailto:support@connectsphere.io",
      webPushPublicKey,
      webPushPrivateKey,
    );
  } else {
    logger.warn(
      { databaseConfigured: Boolean(database) },
      "Browser push notifications are disabled; configure Web Push VAPID keys and a database",
    );
  }

  async function sendToUser(userId: string, payload: PushNotificationPayload): Promise<void> {
    if (!isConfigured || !database) {
      throw new Error("Browser push notifications are not configured.");
    }

    const subscriptions = await database.query<StoredSubscription>(
      "SELECT endpoint, p256dh, auth FROM app_push_subscriptions WHERE user_id = $1",
      [userId],
    );

    await Promise.all(subscriptions.rows.map(async (subscription) => {
      try {
        await sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload),
          {
            TTL: payload.type === "message" ? 86_400 : 60,
            urgency: payload.type === "message" ? "normal" : "high",
            ...(payload.tag ? { topic: payload.tag.slice(0, 32) } : {}),
          },
        );
      } catch (error) {
        if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
          await database.query(
            "DELETE FROM app_push_subscriptions WHERE endpoint = $1",
            [subscription.endpoint],
          );
          logger.info(
            { userId, statusCode: error.statusCode },
            "Removed expired browser push subscription",
          );
          return;
        }

        logger.warn({
          userId,
          statusCode: error instanceof WebPushError ? error.statusCode : undefined,
          errorName: error instanceof Error ? error.name : "UnknownError",
        }, "Browser push delivery failed");
      }
    }));
  }

  return {
    isConfigured,
    publicKey: database && webPushPublicKey && webPushPrivateKey ? webPushPublicKey : null,
    sendToUser,
  };
}

function requirePushSession(database: Pool | undefined) {
  return async (request: Request): Promise<{ userId: string; database: Pool }> => {
    if (!database) {
      throw new ApiError(503, "PUSH_UNAVAILABLE", "Push notifications require a configured database.");
    }
    const userId = await resolveSessionUserId(database, request.cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      throw new ApiError(401, "UNAUTHENTICATED", "Sign in to manage push notifications.");
    }
    return { userId, database };
  };
}

export function createPushRouter(
  database: Pool | undefined,
  logger: AppLogger,
  pushDelivery: Pick<ReturnType<typeof createPushDelivery>, "isConfigured" | "publicKey">,
) {
  const router = Router();
  const getSession = requirePushSession(database);

  router.get("/public-key", (_request, response) => {
    if (!pushDelivery.publicKey) {
      throw new ApiError(503, "PUSH_UNAVAILABLE", "Browser push notifications are not configured yet.");
    }
    response.status(200).json({ publicKey: pushDelivery.publicKey });
  });

  router.post("/subscriptions", async (request, response, next) => {
    try {
      const { userId, database: authenticatedDatabase } = await getSession(request);
      const parsed = subscriptionSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ApiError(400, "INVALID_PUSH_SUBSCRIPTION", "A valid browser push subscription is required.");
      }
      if (!pushDelivery.isConfigured) {
        throw new ApiError(503, "PUSH_UNAVAILABLE", "Browser push notifications are not configured yet.");
      }

      await authenticatedDatabase.query(
        `INSERT INTO app_push_subscriptions (user_id, endpoint, p256dh, auth)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             p256dh = EXCLUDED.p256dh,
             auth = EXCLUDED.auth,
             updated_at = now()`,
        [userId, parsed.data.endpoint, parsed.data.keys.p256dh, parsed.data.keys.auth],
      );
      response.status(201).json({ saved: true });
    } catch (error) {
      if (error instanceof ApiError) {
        next(error);
        return;
      }
      logger.error({
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "Failed to save browser push subscription");
      next(new ApiError(500, "PUSH_SUBSCRIPTION_FAILED", "Could not enable push notifications."));
    }
  });

  router.delete("/subscriptions", async (request, response, next) => {
    try {
      const { userId, database: authenticatedDatabase } = await getSession(request);
      const parsed = z.object({ endpoint: z.string().url().max(4096) }).strict().safeParse(request.body);
      if (!parsed.success) {
        throw new ApiError(400, "INVALID_PUSH_SUBSCRIPTION", "A valid browser push endpoint is required.");
      }
      await authenticatedDatabase.query(
        "DELETE FROM app_push_subscriptions WHERE user_id = $1 AND endpoint = $2",
        [userId, parsed.data.endpoint],
      );
      response.status(200).json({ removed: true });
    } catch (error) {
      if (error instanceof ApiError) {
        next(error);
        return;
      }
      logger.error({
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "Failed to remove browser push subscription");
      next(new ApiError(500, "PUSH_SUBSCRIPTION_FAILED", "Could not disable push notifications."));
    }
  });

  return router;
}
