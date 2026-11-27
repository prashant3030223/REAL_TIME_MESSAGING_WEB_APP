import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import pino from "pino";
import type { Pool } from "pg";
import type { R2AttachmentStorage } from "../../apps/api/src/objectStorage.js";
import { processExpiredMessages } from "../../apps/api/src/messageExpiry.js";

const messageId = "00000000-0000-4000-8000-000000000001";
const conversationId = "00000000-0000-4000-8000-000000000002";
const attachmentId = "00000000-0000-4000-8000-000000000003";

function createStorage(deleteObject: (key: string) => Promise<void>): R2AttachmentStorage {
  return {
    uploadObject: async () => {},
    headObject: async () => ({ metadata: {} }),
    getObject: async () => ({ body: Readable.from([]) }),
    deleteObject,
  };
}

test("expired message cleanup deletes attachments before removing the message row", async () => {
  const operations: string[] = [];
  let claimed = false;
  const client = {
    query: async (query: string) => {
      if (query === "BEGIN" || query === "COMMIT") {
        operations.push(query);
        return { rows: [], rowCount: 0 };
      }
      if (query.includes("FROM app_messages") && query.includes("FOR UPDATE SKIP LOCKED")) {
        if (claimed) return { rows: [], rowCount: 0 };
        claimed = true;
        return {
          rows: [{
            id: messageId,
            conversation_id: conversationId,
            attachments: [{ id: attachmentId, storage: "r2" }],
          }],
          rowCount: 1,
        };
      }
      if (query.includes("DELETE FROM app_messages")) {
        operations.push("delete-row");
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected cleanup query: ${query}`);
    },
    release: () => operations.push("release"),
  };
  const database = { connect: async () => client } as unknown as Pool;
  const storage = createStorage(async (key) => operations.push(`delete-object:${key}`));

  await processExpiredMessages(database, storage, pino({ enabled: false }));

  assert.deepEqual(operations, [
    "BEGIN",
    `delete-object:attachments/${conversationId}/${attachmentId}`,
    "delete-row",
    "COMMIT",
    "release",
  ]);
});

test("expired message remains for retry when an R2 attachment cannot be deleted", async () => {
  const operations: string[] = [];
  const client = {
    query: async (query: string) => {
      if (query === "BEGIN" || query === "COMMIT") return { rows: [], rowCount: 0 };
      if (query.includes("FROM app_messages") && query.includes("FOR UPDATE SKIP LOCKED")) {
        return {
          rows: [{
            id: messageId,
            conversation_id: conversationId,
            attachments: [{ id: attachmentId, storage: "r2" }],
          }],
          rowCount: 1,
        };
      }
      if (query.includes("DELETE FROM app_messages")) {
        operations.push("delete-row");
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected cleanup query: ${query}`);
    },
    release: () => {},
  };
  const database = { connect: async () => client } as unknown as Pool;
  const storage = createStorage(async () => {
    throw new Error("storage unavailable");
  });

  await processExpiredMessages(database, storage, pino({ enabled: false }));

  assert.deepEqual(operations, []);
});
