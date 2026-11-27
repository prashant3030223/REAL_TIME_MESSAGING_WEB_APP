import type { Pool, PoolClient } from "pg";
import type { AppLogger } from "./logger.js";
import {
  canPerformGroupAction,
  DEFAULT_GROUP_PERMISSIONS,
  GroupPermissionsSchema,
} from "./groupPermissions.js";

export type ScheduledMessagePayload = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  text: string;
  timestamp: string;
  status: "sent";
  scheduledFor: string;
  [key: string]: unknown;
};

type DueScheduledMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  sender_avatar: string | null;
  text: string;
  metadata: Record<string, unknown>;
  scheduled_for: Date | string;
  disappearing_timer_hours: number;
  conversation_type: string;
  group_permissions: unknown;
  sender_role: string | null;
};

export async function processDueScheduledMessages(
  database: Pool,
  deliver: (message: ScheduledMessagePayload) => Promise<void>,
  logger: AppLogger,
  batchSize = 25,
) {
  for (let processed = 0; processed < batchSize; processed += 1) {
    let client: PoolClient | undefined;
    let transactionStarted = false;
    let deliveredMessage: ScheduledMessagePayload | undefined;

    try {
      client = await database.connect();
      await client.query("BEGIN");
      transactionStarted = true;

      const due = await client.query<DueScheduledMessage>(
        `SELECT scheduled.id, scheduled.conversation_id, scheduled.sender_id,
                sender.display_name AS sender_name, sender.avatar AS sender_avatar,
                scheduled.text, scheduled.metadata, scheduled.scheduled_for,
                conversation.disappearing_timer_hours, conversation.type AS conversation_type,
                conversation.group_permissions,
                (SELECT member.role
                 FROM app_conversation_members member
                 WHERE member.conversation_id = scheduled.conversation_id
                   AND member.user_id = scheduled.sender_id) AS sender_role
         FROM app_scheduled_messages scheduled
         JOIN app_users sender ON sender.id = scheduled.sender_id
         JOIN app_conversations conversation ON conversation.id = scheduled.conversation_id
         WHERE scheduled.state = 'scheduled' AND scheduled.scheduled_for <= now()
         ORDER BY scheduled.scheduled_for, scheduled.created_at
         LIMIT 1
         FOR UPDATE OF scheduled SKIP LOCKED`,
      );
      const message = due.rows[0];
      if (!message) {
        await client.query("COMMIT");
        transactionStarted = false;
        return;
      }

      const membership = await client.query(
        `SELECT 1 FROM app_conversation_members
         WHERE conversation_id = $1 AND user_id = $2`,
        [message.conversation_id, message.sender_id],
      );
      if (membership.rowCount === 0) {
        await client.query(
          "UPDATE app_scheduled_messages SET state = 'cancelled' WHERE id = $1",
          [message.id],
        );
        await client.query("COMMIT");
        transactionStarted = false;
        continue;
      }

      if (message.conversation_type === "group") {
        const permissions = GroupPermissionsSchema.parse(
          message.group_permissions ?? DEFAULT_GROUP_PERMISSIONS,
        );
        if (!canPerformGroupAction(message.sender_role ?? "", permissions.sendMessages)) {
          await client.query(
            "UPDATE app_scheduled_messages SET state = 'cancelled' WHERE id = $1",
            [message.id],
          );
          await client.query("COMMIT");
          transactionStarted = false;
          logger.warn({
            messageId: message.id,
            conversationId: message.conversation_id,
            senderId: message.sender_id,
          }, "Cancelled scheduled group message because permissions changed");
          continue;
        }
      }

      const inserted = await client.query<{ created_at: Date | string; expires_at: Date | string | null }>(
        `INSERT INTO app_messages
           (id, conversation_id, sender_id, text, reply_to_id, status, metadata, expires_at)
         VALUES (
           $1, $2, $3, $4, NULL, 'sent', $5,
           CASE WHEN $6 > 0 THEN now() + make_interval(hours => $6) ELSE NULL END
         )
         RETURNING created_at, expires_at`,
        [
          message.id,
          message.conversation_id,
          message.sender_id,
          message.text,
          JSON.stringify(message.metadata),
          message.disappearing_timer_hours,
        ],
      );
      const createdAt = inserted.rows[0]?.created_at;
      if (!createdAt) {
        throw new Error("Scheduled message delivery did not create a message row.");
      }
      await client.query(
        `INSERT INTO app_message_receipts (message_id, user_id)
         SELECT $1, member.user_id
         FROM app_conversation_members member
         WHERE member.conversation_id = $2 AND member.user_id <> $3
         ON CONFLICT (message_id, user_id) DO NOTHING`,
        [message.id, message.conversation_id, message.sender_id],
      );

      const scheduledFor = new Date(message.scheduled_for).toISOString();
      deliveredMessage = {
        ...message.metadata,
        id: message.id,
        conversationId: message.conversation_id,
        senderId: message.sender_id,
        senderName: message.sender_name,
        senderAvatar: message.sender_avatar ?? "",
        text: message.text,
        timestamp: new Date(createdAt).toISOString(),
        status: "sent",
        scheduledFor,
        ...(inserted.rows[0]?.expires_at
          ? { expiresAt: new Date(inserted.rows[0].expires_at).toISOString() }
          : {}),
      };

      await client.query(
        `UPDATE app_scheduled_messages
         SET state = 'sent', sent_at = now()
         WHERE id = $1 AND state = 'scheduled'`,
        [message.id],
      );
      await client.query(
        "UPDATE app_conversations SET updated_at = now() WHERE id = $1",
        [message.conversation_id],
      );
      await client.query("COMMIT");
      transactionStarted = false;
    } catch (error) {
      if (client && transactionStarted) {
        await client.query("ROLLBACK");
      }
      logger.error({
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "Failed to deliver a scheduled message");
      throw error;
    } finally {
      client?.release();
    }

    if (deliveredMessage) {
      try {
        await deliver(deliveredMessage);
      } catch (error) {
        logger.error({
          messageId: deliveredMessage.id,
          errorName: error instanceof Error ? error.name : "UnknownError",
        }, "Scheduled message was saved but realtime delivery failed");
      }
    }
  }
}

export function createScheduledMessageScheduler(
  database: Pool,
  deliver: (message: ScheduledMessagePayload) => Promise<void>,
  logger: AppLogger,
) {
  let running: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (running) return;
    running = processDueScheduledMessages(database, deliver, logger)
      .catch((error: unknown) => {
        logger.error({
          errorName: error instanceof Error ? error.name : "UnknownError",
        }, "Scheduled message polling failed");
      })
      .finally(() => {
        running = null;
      });
  }, 1_000);
  timer.unref();

  return {
    async shutdown() {
      clearInterval(timer);
      await running;
    },
  };
}
