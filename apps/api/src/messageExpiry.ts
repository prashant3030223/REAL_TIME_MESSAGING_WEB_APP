import type { Pool, PoolClient } from "pg";
import type { AppLogger } from "./logger.js";
import { deleteR2Attachments } from "./objectStorage.js";
import type { R2AttachmentStorage } from "./objectStorage.js";

type ExpiredMessageRow = {
  id: string;
  conversation_id: string;
  attachments: unknown;
};

export async function processExpiredMessages(
  database: Pool,
  attachmentStorage: R2AttachmentStorage,
  logger: AppLogger,
  batchSize = 25,
) {
  const client: PoolClient = await database.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const expired = await client.query<ExpiredMessageRow>(
      `SELECT id, conversation_id, attachments
       FROM app_messages
       WHERE expires_at <= now()
       ORDER BY expires_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [batchSize],
    );

    for (const message of expired.rows) {
      try {
        await deleteR2Attachments(attachmentStorage, message.conversation_id, message.attachments);
      } catch (error) {
        logger.error({
          messageId: message.id,
          errorName: error instanceof Error ? error.name : "UnknownError",
        }, "Expired message attachments could not be deleted; message retained for retry");
        continue;
      }

      await client.query(
        "DELETE FROM app_messages WHERE id = $1 AND expires_at <= now()",
        [message.id],
      );
    }

    await client.query("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function createMessageExpiryScheduler(
  database: Pool,
  attachmentStorage: R2AttachmentStorage,
  logger: AppLogger,
) {
  let running: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (running) return;
    running = processExpiredMessages(database, attachmentStorage, logger)
      .catch((error: unknown) => {
        logger.error({
          errorName: error instanceof Error ? error.name : "UnknownError",
        }, "Expired-message cleanup failed");
      })
      .finally(() => {
        running = null;
      });
  }, 30_000);
  timer.unref();

  return {
    async shutdown() {
      clearInterval(timer);
      await running;
    },
  };
}
