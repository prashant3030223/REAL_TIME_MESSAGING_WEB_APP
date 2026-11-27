import test from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import type { Pool } from "pg";
import { processDueScheduledMessages } from "../../apps/api/src/scheduledMessages.js";

test("due scheduled messages are persisted before realtime delivery", async () => {
  const messageId = "00000000-0000-4000-8000-000000000001";
  const conversationId = "00000000-0000-4000-8000-000000000002";
  const senderId = "00000000-0000-4000-8000-000000000003";
  const scheduledFor = new Date(Date.now() - 1_000).toISOString();
  const createdAt = new Date();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const statements: string[] = [];
  let dueClaimed = false;
  let releaseCalled = false;
  let delivered: Record<string, unknown> | null = null;
  const client = {
    query: async (query: string, values: unknown[] = []) => {
      statements.push(query);
      if (query === "BEGIN" || query === "COMMIT" || query === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      if (query.includes("FROM app_scheduled_messages scheduled")) {
        if (dueClaimed) return { rows: [], rowCount: 0 };
        dueClaimed = true;
        return {
          rows: [{
            id: messageId,
            conversation_id: conversationId,
            sender_id: senderId,
            sender_name: "Sender",
            sender_avatar: "/sender.svg",
            text: "Deliver this",
            metadata: { replyTo: { id: "reply-1", senderName: "Peer", text: "Previous" } },
            scheduled_for: scheduledFor,
            disappearing_timer_hours: 24,
          }],
          rowCount: 1,
        };
      }
      if (query.includes("INSERT INTO app_messages")) {
        assert.deepEqual(values.slice(0, 4), [messageId, conversationId, senderId, "Deliver this"]);
        assert.ok(statements.includes("BEGIN"));
        assert.equal(values[5], 24);
        assert.match(query, /expires_at/);
        return { rows: [{ created_at: createdAt, expires_at: expiresAt }], rowCount: 1 };
      }
      if (query.includes("INSERT INTO app_message_receipts")) {
        assert.deepEqual(values, [messageId, conversationId, senderId]);
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("FROM app_conversation_members")) {
        assert.deepEqual(values, [conversationId, senderId]);
        return { rows: [{}], rowCount: 1 };
      }
      if (query.includes("UPDATE app_scheduled_messages")) {
        assert.deepEqual(values, [messageId]);
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("UPDATE app_conversations")) {
        assert.deepEqual(values, [conversationId]);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected scheduled-message query: ${query}`);
    },
    release: () => {
      releaseCalled = true;
    },
  };
  const database = {
    connect: async () => client,
  } as unknown as Pool;

  await processDueScheduledMessages(
    database,
    async (message) => {
      assert.ok(statements.includes("COMMIT"));
      delivered = message;
    },
    pino({ enabled: false }),
  );

  assert.equal(releaseCalled, true);
  assert.equal(statements.filter((query) => query === "BEGIN").length, 2);
  assert.equal(statements.filter((query) => query === "COMMIT").length, 2);
  assert.equal(delivered?.["id"], messageId);
  assert.equal(delivered?.["status"], "sent");
  assert.equal(delivered?.["senderId"], senderId);
  assert.equal(delivered?.["text"], "Deliver this");
  assert.equal(delivered?.["expiresAt"], expiresAt.toISOString());
  assert.deepEqual(delivered?.["replyTo"], { id: "reply-1", senderName: "Peer", text: "Previous" });
});

test("scheduled group messages are cancelled if admins-only permissions changed before delivery", async () => {
  const messageId = "00000000-0000-4000-8000-000000000011";
  const conversationId = "00000000-0000-4000-8000-000000000012";
  const senderId = "00000000-0000-4000-8000-000000000013";
  let dueClaimed = false;
  let cancelled = false;
  let insertedMessage = false;
  let deliveryCalled = false;
  const client = {
    query: async (query: string, values: unknown[] = []) => {
      if (query === "BEGIN" || query === "COMMIT" || query === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      if (query.includes("FROM app_scheduled_messages scheduled")) {
        if (dueClaimed) return { rows: [], rowCount: 0 };
        dueClaimed = true;
        return {
          rows: [{
            id: messageId,
            conversation_id: conversationId,
            sender_id: senderId,
            sender_name: "Member",
            sender_avatar: null,
            text: "No longer allowed",
            metadata: {},
            scheduled_for: new Date(Date.now() - 1_000).toISOString(),
            disappearing_timer_hours: 0,
            conversation_type: "group",
            group_permissions: {
              sendMessages: "admins",
              sendMedia: "everyone",
              addMembers: "admins",
              editGroupInfo: "admins",
              pinMessages: "everyone",
              createPolls: "everyone",
            },
            sender_role: "member",
          }],
          rowCount: 1,
        };
      }
      if (query.includes("FROM app_conversation_members")) {
        return { rows: [{}], rowCount: 1 };
      }
      if (query.includes("UPDATE app_scheduled_messages SET state = 'cancelled'")) {
        assert.deepEqual(values, [messageId]);
        cancelled = true;
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("INSERT INTO app_messages")) {
        insertedMessage = true;
      }
      throw new Error(`Unexpected permission scheduler query: ${query}`);
    },
    release: () => {},
  };
  const database = {
    connect: async () => client,
  } as unknown as Pool;

  await processDueScheduledMessages(
    database,
    async () => {
      deliveryCalled = true;
    },
    pino({ enabled: false }),
  );

  assert.equal(cancelled, true);
  assert.equal(insertedMessage, false);
  assert.equal(deliveryCalled, false);
});
