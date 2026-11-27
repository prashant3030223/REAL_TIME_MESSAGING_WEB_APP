import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { ApiError } from "./errors.js";
import type { AppLogger } from "./logger.js";
import { resolveSessionUserId, SESSION_COOKIE_NAME } from "./auth.js";

const CreateRequestSchema = z.object({
  userId: z.string().uuid(),
}).strict();

export async function areUsersConnected(
  database: Pool,
  firstUserId: string,
  secondUserId: string,
): Promise<boolean> {
  if (firstUserId === secondUserId) return false;
  const result = await database.query(
    `SELECT 1
     FROM app_user_connections connection
     WHERE connection.user_low = LEAST($1::uuid, $2::uuid)
       AND connection.user_high = GREATEST($1::uuid, $2::uuid)
       AND NOT EXISTS (
         SELECT 1 FROM app_user_blocks block
         WHERE (block.blocker_id = $1 AND block.blocked_id = $2)
            OR (block.blocker_id = $2 AND block.blocked_id = $1)
       )`,
    [firstUserId, secondUserId],
  );
  return Boolean(result.rows[0]);
}

export function createConnectionsRouter(database: Pool | undefined, logger: AppLogger) {
  const router = Router();

  async function getUserId(request: Request): Promise<string> {
    if (!database) {
      throw new ApiError(503, "SERVICE_UNAVAILABLE", "Connection services are not configured.");
    }
    try {
      const userId = await resolveSessionUserId(
        database,
        request.cookies?.[SESSION_COOKIE_NAME],
      );
      if (!userId) throw new ApiError(401, "UNAUTHENTICATED", "Sign in to manage connections.");
      return userId;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error({
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "Failed to verify connection session");
      throw new ApiError(503, "AUTHENTICATION_UNAVAILABLE", "Could not verify the current session.");
    }
  }

  router.get("/", async (request, response, next) => {
    try {
      const userId = await getUserId(request);
      const [connections, receivedRequests, sentRequests, blockedUsers] = await Promise.all([
        database!.query(
          `SELECT user_profile.id, user_profile.email, user_profile.phone, user_profile.username,
                  user_profile.display_name AS "displayName", user_profile.avatar, user_profile.bio,
                  user_profile.status_text AS "statusText", user_profile.profile_photo_protection AS "profilePhotoProtection",
                  user_profile.last_seen_at AS "lastSeen"
           FROM app_user_connections connection
           JOIN app_users user_profile
             ON user_profile.id = CASE
               WHEN connection.user_low = $1 THEN connection.user_high ELSE connection.user_low END
           WHERE connection.user_low = $1 OR connection.user_high = $1
           ORDER BY user_profile.display_name`,
          [userId],
        ),
        database!.query(
          `SELECT request.id, request.created_at AS "createdAt",
                  sender.id AS "userId", sender.display_name AS "displayName", sender.username,
                  sender.avatar, sender.bio, sender.phone, sender.email,
                  sender.profile_photo_protection AS "profilePhotoProtection"
           FROM app_contact_requests request
           JOIN app_users sender ON sender.id = request.sender_id
           WHERE request.recipient_id = $1 AND request.status = 'pending'
           ORDER BY request.created_at DESC`,
          [userId],
        ),
        database!.query(
          `SELECT request.id, request.created_at AS "createdAt",
                  recipient.id AS "userId", recipient.display_name AS "displayName", recipient.username,
                  recipient.avatar, recipient.bio, recipient.phone, recipient.email,
                  recipient.profile_photo_protection AS "profilePhotoProtection"
           FROM app_contact_requests request
           JOIN app_users recipient ON recipient.id = request.recipient_id
           WHERE request.sender_id = $1 AND request.status = 'pending'
           ORDER BY request.created_at DESC`,
          [userId],
        ),
        database!.query(
          `SELECT user_profile.id, user_profile.email, user_profile.phone, user_profile.username,
                  user_profile.display_name AS "displayName", user_profile.avatar, user_profile.bio
           FROM app_user_blocks block
           JOIN app_users user_profile ON user_profile.id = block.blocked_id
           WHERE block.blocker_id = $1
           ORDER BY block.created_at DESC`,
          [userId],
        ),
      ]);
      response.status(200).json({
        connections: connections.rows,
        requestsReceived: receivedRequests.rows,
        requestsSent: sentRequests.rows,
        blockedUsers: blockedUsers.rows,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/requests", async (request, response, next) => {
    const parsed = CreateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      next(new ApiError(400, "INVALID_CONNECTION_REQUEST", "Choose a valid user to connect with."));
      return;
    }
    let client: PoolClient | undefined;
    try {
      const userId = await getUserId(request);
      if (userId === parsed.data.userId) {
        throw new ApiError(400, "INVALID_CONNECTION_REQUEST", "You cannot send a connection request to yourself.");
      }
      if (await areUsersConnected(database!, userId, parsed.data.userId)) {
        response.status(200).json({ connected: true });
        return;
      }

      client = await database!.connect();
      await client.query("BEGIN");
      const target = await client.query("SELECT id FROM app_users WHERE id = $1", [parsed.data.userId]);
      if (target.rows.length === 0) {
        throw new ApiError(404, "USER_NOT_FOUND", "This user could not be found.");
      }
      const blocked = await client.query(
        `SELECT 1 FROM app_user_blocks
         WHERE (blocker_id = $1 AND blocked_id = $2)
            OR (blocker_id = $2 AND blocked_id = $1)`,
        [userId, parsed.data.userId],
      );
      if (blocked.rows.length > 0) {
        throw new ApiError(403, "CONNECTION_BLOCKED", "A connection request cannot be sent to this user.");
      }
      const reverseRequest = await client.query<{ id: string }>(
        `UPDATE app_contact_requests
         SET status = 'accepted', updated_at = now()
         WHERE sender_id = $1 AND recipient_id = $2 AND status = 'pending'
         RETURNING id`,
        [parsed.data.userId, userId],
      );
      if (reverseRequest.rows.length > 0) {
        await client.query(
          `UPDATE app_contact_requests
           SET status = 'accepted', updated_at = now()
           WHERE sender_id = $1 AND recipient_id = $2 AND status = 'pending'`,
          [userId, parsed.data.userId],
        );
        await client.query(
          `INSERT INTO app_user_connections (user_low, user_high)
           VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))
           ON CONFLICT DO NOTHING`,
          [userId, parsed.data.userId],
        );
        await client.query("COMMIT");
        response.status(200).json({ connected: true });
        return;
      }

      const inserted = await client.query(
        `INSERT INTO app_contact_requests (sender_id, recipient_id)
         VALUES ($1, $2)
         ON CONFLICT (sender_id, recipient_id)
         DO UPDATE SET status = 'pending', updated_at = now()
         RETURNING id`,
        [userId, parsed.data.userId],
      );
      await client.query("COMMIT");
      response.status(201).json({ requestId: inserted.rows[0]?.id, status: "pending" });
    } catch (error) {
      if (client) await client.query("ROLLBACK");
      next(error);
    } finally {
      client?.release();
    }
  });

  router.post("/requests/:requestId/accept", async (request, response, next) => {
    const requestId = request.params["requestId"] ?? "";
    if (!z.string().uuid().safeParse(requestId).success) {
      next(new ApiError(400, "INVALID_CONNECTION_REQUEST", "A valid connection request is required."));
      return;
    }
    let client: PoolClient | undefined;
    try {
      const userId = await getUserId(request);
      client = await database!.connect();
      await client.query("BEGIN");
      const accepted = await client.query<{ sender_id: string }>(
        `UPDATE app_contact_requests
         SET status = 'accepted', updated_at = now()
         WHERE id = $1 AND recipient_id = $2 AND status = 'pending'
         RETURNING sender_id`,
        [requestId, userId],
      );
      const senderId = accepted.rows[0]?.sender_id;
      if (!senderId) {
        throw new ApiError(404, "CONNECTION_REQUEST_NOT_FOUND", "This pending connection request was not found.");
      }
      const blocked = await client.query(
        `SELECT 1 FROM app_user_blocks
         WHERE (blocker_id = $1 AND blocked_id = $2)
            OR (blocker_id = $2 AND blocked_id = $1)`,
        [userId, senderId],
      );
      await client.query(
        `UPDATE app_contact_requests
         SET status = 'accepted', updated_at = now()
         WHERE sender_id = $1 AND recipient_id = $2 AND status = 'pending'`,
        [userId, senderId],
      );
      if (blocked.rows.length > 0) {
        throw new ApiError(403, "CONNECTION_BLOCKED", "This user is blocked and cannot be connected.");
      }
      await client.query(
        `INSERT INTO app_user_connections (user_low, user_high)
         VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))
         ON CONFLICT DO NOTHING`,
        [userId, senderId],
      );
      await client.query("COMMIT");
      response.status(200).json({ connected: true, userId: senderId });
    } catch (error) {
      if (client) await client.query("ROLLBACK");
      next(error);
    } finally {
      client?.release();
    }
  });

  router.post("/requests/:requestId/decline", async (request, response, next) => {
    const requestId = request.params["requestId"] ?? "";
    if (!z.string().uuid().safeParse(requestId).success) {
      next(new ApiError(400, "INVALID_CONNECTION_REQUEST", "A valid connection request is required."));
      return;
    }
    try {
      const userId = await getUserId(request);
      const declined = await database!.query(
        `UPDATE app_contact_requests
         SET status = 'declined', updated_at = now()
         WHERE id = $1 AND recipient_id = $2 AND status = 'pending'
         RETURNING id`,
        [requestId, userId],
      );
      if (declined.rowCount === 0) {
        throw new ApiError(404, "CONNECTION_REQUEST_NOT_FOUND", "This pending connection request was not found.");
      }
      response.status(200).json({ declined: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/blocked/:userId", async (request, response, next) => {
    const targetUserId = request.params["userId"] ?? "";
    if (!z.string().uuid().safeParse(targetUserId).success) {
      next(new ApiError(400, "INVALID_USER_ID", "Choose a valid user to block."));
      return;
    }
    let client: PoolClient | undefined;
    try {
      const userId = await getUserId(request);
      if (userId === targetUserId) {
        throw new ApiError(400, "INVALID_BLOCK", "You cannot block your own account.");
      }
      client = await database!.connect();
      await client.query("BEGIN");
      const target = await client.query("SELECT id FROM app_users WHERE id = $1", [targetUserId]);
      if (target.rowCount === 0) {
        throw new ApiError(404, "USER_NOT_FOUND", "This user could not be found.");
      }
      await client.query(
        "INSERT INTO app_user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [userId, targetUserId],
      );
      await client.query(
        `DELETE FROM app_user_connections
         WHERE user_low = LEAST($1::uuid, $2::uuid)
           AND user_high = GREATEST($1::uuid, $2::uuid)`,
        [userId, targetUserId],
      );
      await client.query(
        `UPDATE app_contact_requests
         SET status = 'declined', updated_at = now()
         WHERE status = 'pending'
           AND ((sender_id = $1 AND recipient_id = $2)
             OR (sender_id = $2 AND recipient_id = $1))`,
        [userId, targetUserId],
      );
      await client.query("COMMIT");
      response.status(200).json({ blocked: true });
    } catch (error) {
      if (client) await client.query("ROLLBACK");
      next(error);
    } finally {
      client?.release();
    }
  });

  router.delete("/blocked/:userId", async (request, response, next) => {
    const targetUserId = request.params["userId"] ?? "";
    if (!z.string().uuid().safeParse(targetUserId).success) {
      next(new ApiError(400, "INVALID_USER_ID", "Choose a valid user to unblock."));
      return;
    }
    try {
      const userId = await getUserId(request);
      const unblocked = await database!.query(
        "DELETE FROM app_user_blocks WHERE blocker_id = $1 AND blocked_id = $2 RETURNING blocked_id",
        [userId, targetUserId],
      );
      if (unblocked.rowCount === 0) {
        throw new ApiError(404, "BLOCKED_USER_NOT_FOUND", "This user is not in your blocked contacts.");
      }
      response.status(200).json({ unblocked: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
