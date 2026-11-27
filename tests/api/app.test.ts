import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import pino from "pino";
import { createApp } from "../../apps/api/src/app.js";
import { SESSION_COOKIE_NAME } from "../../apps/api/src/auth.js";
import type { R2AttachmentStorage } from "../../apps/api/src/objectStorage.js";

async function withServer(
  database: Pool | undefined,
  run: (baseUrl: string) => Promise<void>,
  options: {
    staticDir?: string;
    corsOrigin?: string;
    trustProxy?: boolean;
    notifyReadReceipt?: (conversationId: string, readerId: string, messageIds: string[]) => Promise<void>;
    notifyMessageDeleted?: (payload: {
      messageId: string;
      conversationId: string;
      deletedBy: string;
      ghostUnsend?: boolean;
    }) => Promise<void>;
    pushDelivery?: { isConfigured: boolean; publicKey: string | null };
    attachmentStorage?: R2AttachmentStorage;
  } = {},
) {
  const logger = pino({ enabled: false });
  const app = createApp({ logger, ...(database ? { database } : {}), ...options });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("liveness endpoint returns a request ID and healthy response", async () => {
  await withServer(undefined, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health/live`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
    assert.deepEqual(await response.json(), { status: "ok" });
  });
});

test("reopening the same direct chat reuses one conversation", async () => {
  await withServer(undefined, async (baseUrl) => {
    const peerUserId = "00000000-0000-4000-8000-000000000010";
    const payload = {
      name: "Arushi",
      type: "direct",
      peerUserId,
    };
    const first = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const second = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const firstBody = await first.json() as { conversation: { id: string } };
    const secondBody = await second.json() as { conversation: { id: string } };
    assert.equal(firstBody.conversation.id, secondBody.conversation.id);

    const list = await fetch(`${baseUrl}/api/conversations`);
    const listBody = await list.json() as { conversations: Array<{ peerUserId?: string }> };
    assert.equal(listBody.conversations.filter((conversation) => conversation.peerUserId === peerUserId).length, 1);
  });
});

test("readiness reports missing database as not ready", async () => {
  await withServer(undefined, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health/ready`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      status: "not_ready",
      dependencies: { database: "not_configured" },
    });
  });
});

test("account routes report unavailable without database configuration", async () => {
  await withServer(undefined, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "person@example.com",
        username: "person",
        displayName: "Person",
        password: "a-long-enough-password",
      }),
    });
    assert.equal(response.status, 503);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, "SERVICE_UNAVAILABLE");
  });
});

test("browser push API reports missing VAPID setup and rejects unauthenticated subscriptions", async () => {
  const database = {
    query: async () => ({ rows: [], rowCount: 0 }),
  } as unknown as Pool;

  await withServer(database, async (baseUrl) => {
    const keyResponse = await fetch(`${baseUrl}/api/push/public-key`);
    assert.equal(keyResponse.status, 503);
    assert.equal(
      (await keyResponse.json() as { error: { code: string } }).error.code,
      "PUSH_UNAVAILABLE",
    );

    const subscriptionResponse = await fetch(`${baseUrl}/api/push/subscriptions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        endpoint: "https://fcm.googleapis.com/push/send/example",
        keys: { p256dh: "a-valid-enough-public-key-value", auth: "a-valid-auth-value" },
      }),
    });
    assert.equal(subscriptionResponse.status, 401);
    assert.equal(
      (await subscriptionResponse.json() as { error: { code: string } }).error.code,
      "UNAUTHENTICATED",
    );
  });
});

test("browser push subscriptions reject endpoints outside supported push services", async () => {
  const userId = "00000000-0000-4000-8000-000000000201";
  const database = {
    query: async (query: string) => {
      if (query.includes("FROM app_sessions")) {
        return { rows: [{ user_id: userId }], rowCount: 1 };
      }
      throw new Error(`Unexpected push-subscription database query: ${query}`);
    },
  } as unknown as Pool;

  await withServer(database, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/push/subscriptions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE_NAME}=${randomBytes(32).toString("base64url")}`,
      },
      body: JSON.stringify({
        endpoint: "https://attacker.example/push",
        keys: { p256dh: "a-valid-enough-public-key-value", auth: "a-valid-auth-value" },
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(
      (await response.json() as { error: { code: string } }).error.code,
      "INVALID_PUSH_SUBSCRIPTION",
    );
  }, {
    pushDelivery: { isConfigured: true, publicKey: "test-public-key" },
  });
});

test("database-backed conversations and messages require an authenticated session", async () => {
  const database = {
    query: async () => {
      throw new Error("Session lookup should be skipped when no cookie is present.");
    },
  } as unknown as Pool;

  await withServer(database, async (baseUrl) => {
    const conversations = await fetch(`${baseUrl}/api/conversations`);
    assert.equal(conversations.status, 401);
    assert.equal((await conversations.json() as { error: { code: string } }).error.code, "UNAUTHENTICATED");

    const messages = await fetch(`${baseUrl}/api/conversations/00000000-0000-4000-8000-000000000001/messages`);
    assert.equal(messages.status, 401);
    assert.equal((await messages.json() as { error: { code: string } }).error.code, "UNAUTHENTICATED");

    const conversationLock = await fetch(
      `${baseUrl}/api/conversations/00000000-0000-4000-8000-000000000001/lock`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isLocked: true }),
      },
    );
    assert.equal(conversationLock.status, 401);
    assert.equal((await conversationLock.json() as { error: { code: string } }).error.code, "UNAUTHENTICATED");

    const update = await fetch(
      `${baseUrl}/api/conversations/00000000-0000-4000-8000-000000000001/messages/00000000-0000-4000-8000-000000000002`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metadata: { isStarred: true } }),
      },
    );
    assert.equal(update.status, 401);
    assert.equal((await update.json() as { error: { code: string } }).error.code, "UNAUTHENTICATED");

    const pollVote = await fetch(
      `${baseUrl}/api/conversations/00000000-0000-4000-8000-000000000001/messages/00000000-0000-4000-8000-000000000002/poll-votes`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ optionId: "option-a", userId: "forged-user-id" }),
      },
    );
    assert.equal(pollVote.status, 401);
    assert.equal((await pollVote.json() as { error: { code: string } }).error.code, "UNAUTHENTICATED");

    const scheduledMessage = await fetch(
      `${baseUrl}/api/conversations/00000000-0000-4000-8000-000000000001/scheduled-messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "00000000-0000-4000-8000-000000000004",
          text: "Scheduled without auth",
          scheduledFor: new Date(Date.now() + 60_000).toISOString(),
        }),
      },
    );
    assert.equal(scheduledMessage.status, 401);
    assert.equal((await scheduledMessage.json() as { error: { code: string } }).error.code, "UNAUTHENTICATED");

    const timer = await fetch(
      `${baseUrl}/api/conversations/00000000-0000-4000-8000-000000000001/disappearing-timer`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hours: 24 }),
      },
    );
    assert.equal(timer.status, 401);
  });
});

test("conversation disappearing timer validates and persists member settings", async () => {
  const sessionToken = randomBytes(32).toString("base64url");
  const userId = "00000000-0000-4000-8000-000000000011";
  const conversationId = "00000000-0000-4000-8000-000000000012";
  const statements: string[] = [];
  const database = {
    query: async (sql: string, values: unknown[] = []) => {
      statements.push(sql);
      if (sql.includes("SELECT user_id FROM app_sessions")) return { rows: [{ user_id: userId }] };
      if (sql.includes("SELECT 1 FROM app_conversation_members own")) {
        return { rows: [{ "?column?": 1 }], rowCount: 1 };
      }
      if (sql.includes("UPDATE app_conversations") && sql.includes("disappearing_timer_hours")) {
        assert.deepEqual(values, [conversationId, userId, 168]);
        return { rows: [{ disappearing_timer_hours: 168 }], rowCount: 1 };
      }
      throw new Error(`Unexpected disappearing-timer query: ${sql}`);
    },
  } as unknown as Pool;

  await withServer(database, async (baseUrl) => {
    const endpoint = `${baseUrl}/api/conversations/${conversationId}/disappearing-timer`;
    const invalid = await fetch(endpoint, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      },
      body: JSON.stringify({ hours: 721 }),
    });
    assert.equal(invalid.status, 400);

    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      },
      body: JSON.stringify({ hours: 168 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { disappearingTimerHours: 168 });
    assert.ok(statements.some((sql) => sql.includes("UPDATE app_conversations")));
  });
});

test("core-contact auto-read sends a live read receipt", async () => {
  const sessionToken = randomBytes(32).toString("base64url");
  const userId = "00000000-0000-4000-8000-000000000001";
  const botId = "00000000-0000-4000-8000-000000000002";
  const conversationId = "00000000-0000-4000-8000-000000000003";
  const messageId = "00000000-0000-4000-8000-000000000004";
  let resolveReceipt!: (receipt: { conversationId: string; readerId: string; messageIds: string[] }) => void;
  const receiptReceived = new Promise<{ conversationId: string; readerId: string; messageIds: string[] }>((resolve) => {
    resolveReceipt = resolve;
  });
  const database = {
    query: async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT user_id FROM app_sessions")) {
        assert.equal(
          (values[0] as Buffer).toString("hex"),
          createHash("sha256").update(sessionToken).digest("hex"),
        );
        return { rows: [{ user_id: userId }] };
      }
      if (sql.includes("SELECT 1 FROM app_conversation_members")) {
        return { rows: [{ "?column?": 1 }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO app_messages") && sql.includes("RETURNING id, conversation_id")) {
        assert.match(sql, /make_interval\(hours => disappearing_timer_hours\)/);
        return {
          rows: [{
            id: messageId,
            conversation_id: conversationId,
            sender_id: userId,
            text: "Hello",
            attachments: null,
            voice_note: null,
            status: "sent",
            metadata: {},
            created_at: new Date(),
            expires_at: new Date(Date.now() + 60 * 60 * 1000),
          }],
        };
      }
      if (sql.includes("SELECT display_name, avatar FROM app_users")) {
        return { rows: [{ display_name: "Sender", avatar: null }] };
      }
      if (sql.includes("SELECT m.user_id, u.display_name, u.email")) {
        return { rows: [{ user_id: botId, display_name: "Sphere AI", email: "ai@connectsphere.io" }] };
      }
      if (sql.includes("UPDATE app_messages SET status = 'read'")) {
        return { rows: [{ id: messageId }] };
      }
      if (sql.includes("UPDATE app_conversations")) return { rows: [] };
      if (sql.includes("INSERT INTO app_messages (conversation_id, sender_id, text, status)")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected conversations test database query: ${sql}`);
    },
  } as unknown as Pool;

  await withServer(database, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      },
      body: JSON.stringify({ id: messageId, text: "Hello" }),
    });
    assert.equal(response.status, 201);
    const savedMessage = (await response.json() as { message: Record<string, unknown> }).message;
    assert.equal(typeof savedMessage.expiresAt, "string");

    let receiptTimeout: ReturnType<typeof setTimeout> | undefined;
    const receipt = await Promise.race([
      receiptReceived,
      new Promise<never>((_, reject) => {
        receiptTimeout = setTimeout(() => reject(new Error("Timed out waiting for read receipt")), 2000);
      }),
    ]).finally(() => {
      if (receiptTimeout) clearTimeout(receiptTimeout);
    });
    assert.deepEqual(receipt, {
      conversationId,
      readerId: botId,
      messageIds: [messageId],
    });
  }, {
    notifyReadReceipt: async (readConversationId, readerId, messageIds) => {
      resolveReceipt({ conversationId: readConversationId, readerId, messageIds });
    },
  });
});

test("message metadata updates do not require message ownership when the text is unchanged", async () => {
  const currentUserId = "00000000-0000-4000-8000-000000000003";
  const messageOwnerId = "00000000-0000-4000-8000-000000000004";
  const database = {
    query: async (query: string) => {
      if (query.includes("FROM app_sessions")) {
        return { rows: [{ user_id: currentUserId }], rowCount: 1 };
      }
      if (query.includes("FROM app_conversation_members")) {
        return { rows: [{}], rowCount: 1 };
      }
      if (query.includes("SELECT sender_id, text, attachments FROM app_messages")) {
        return { rows: [{ sender_id: messageOwnerId, text: "Original message", attachments: null }], rowCount: 1 };
      }
      if (query.includes("SET text = COALESCE")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected database query: ${query}`);
    },
  } as unknown as Pool;

  await withServer(database, async (baseUrl) => {
    const cookie = `${SESSION_COOKIE_NAME}=${"A".repeat(43)}`;
    const endpoint = `${baseUrl}/api/conversations/00000000-0000-4000-8000-000000000001/messages/00000000-0000-4000-8000-000000000002`;
    const metadataUpdate = await fetch(endpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ text: "Original message", metadata: { isStarred: true } }),
    });
    assert.equal(metadataUpdate.status, 200);

    const textUpdate = await fetch(endpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ text: "Edited by another member" }),
    });
    assert.equal(textUpdate.status, 403);
    assert.equal((await textUpdate.json() as { error: { code: string } }).error.code, "MESSAGE_UPDATE_FORBIDDEN");
  });
});

test("message editing marks sent text as edited and rejects empty edits", async () => {
  const sessionToken = randomBytes(32).toString("base64url");
  const currentUserId = "00000000-0000-4000-8000-000000000003";
  const conversationId = "00000000-0000-4000-8000-000000000001";
  const messageId = "00000000-0000-4000-8000-000000000002";
  let updateValues: unknown[] | undefined;
  let updateQuery = "";
  const database = {
    query: async (query: string, values: unknown[] = []) => {
      if (query.includes("FROM app_sessions")) {
        return { rows: [{ user_id: currentUserId }], rowCount: 1 };
      }
      if (query.includes("FROM app_conversation_members")) {
        return { rows: [{}], rowCount: 1 };
      }
      if (query.includes("SELECT sender_id, text, attachments FROM app_messages")) {
        return {
          rows: [{ sender_id: currentUserId, text: "Original text", attachments: null }],
          rowCount: 1,
        };
      }
      if (query.includes("SET text = COALESCE")) {
        updateQuery = query;
        updateValues = values;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected message-edit database query: ${query}`);
    },
  } as unknown as Pool;

  await withServer(database, async (baseUrl) => {
    const endpoint = `${baseUrl}/api/conversations/${conversationId}/messages/${messageId}`;
    const headers = {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
    };
    const edited = await fetch(endpoint, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ text: "Updated text" }),
    });
    assert.equal(edited.status, 200);
    assert.deepEqual(await edited.json(), { updated: true });
    assert.deepEqual(JSON.parse(String(updateValues?.[1])), { isEdited: true });
    assert.equal(updateValues?.[8], true);
    assert.match(updateQuery, /COALESCE\(metadata->>'isDeleted', 'false'\) <> 'true'/);

    const emptyEdit = await fetch(endpoint, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ text: "   " }),
    });
    assert.equal(emptyEdit.status, 400);
    assert.equal((await emptyEdit.json() as { error: { code: string } }).error.code, "EMPTY_MESSAGE");
  });
});

test("pinning a message replaces the conversation's previous pinned message", async () => {
  const sessionToken = randomBytes(32).toString("base64url");
  const currentUserId = "00000000-0000-4000-8000-000000000003";
  const conversationId = "00000000-0000-4000-8000-000000000001";
  const messageId = "00000000-0000-4000-8000-000000000002";
  const statements: string[] = [];
  let releaseCalled = false;
  const client = {
    query: async (query: string, values: unknown[] = []) => {
      statements.push(query);
      if (query === "BEGIN" || query === "COMMIT" || query === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      if (query.includes("FROM app_conversation_members")) {
        return { rows: [{}], rowCount: 1 };
      }
      if (query.includes("FROM app_conversations")) {
        return { rows: [{ id: conversationId }], rowCount: 1 };
      }
      if (query.includes("FROM app_messages") && query.includes("FOR UPDATE")) {
        return { rows: [{ id: messageId }], rowCount: 1 };
      }
      if (query.includes("id <> $2 AND metadata->>'isPinned' = 'true'")) {
        assert.deepEqual(values, [conversationId, messageId]);
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("SET metadata = jsonb_set") && query.includes("$3::jsonb")) {
        assert.deepEqual(values, [messageId, conversationId, "true"]);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected pin-message database query: ${query}`);
    },
    release: () => { releaseCalled = true; },
  };
  const database = {
    query: async (query: string) => {
      if (query.includes("FROM app_sessions")) {
        return { rows: [{ user_id: currentUserId }], rowCount: 1 };
      }
      throw new Error(`Unexpected pool query: ${query}`);
    },
    connect: async () => client,
  } as unknown as Pool;

  await withServer(database, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/conversations/${conversationId}/messages/${messageId}/pin`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
        },
        body: JSON.stringify({ isPinned: true }),
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { isPinned: true });
  });

  assert.ok(statements.includes("BEGIN"));
  assert.ok(statements.includes("COMMIT"));
  assert.equal(statements.filter((query) => query.includes("id <> $2 AND metadata->>'isPinned' = 'true'")).length, 1);
  assert.equal(releaseCalled, true);
});

test("scheduled messages require authentication, persist for the sender, and can be cancelled", async () => {
  const sessionToken = randomBytes(32).toString("base64url");
  const currentUserId = "00000000-0000-4000-8000-000000000003";
  const conversationId = "00000000-0000-4000-8000-000000000001";
  const messageId = "00000000-0000-4000-8000-000000000002";
  const scheduledFor = new Date(Date.now() + 3_600_000).toISOString();
  let stored: Record<string, unknown> | null = null;
  const database = {
    query: async (query: string, values: unknown[] = []) => {
      if (query.includes("FROM app_sessions")) {
        return { rows: [{ user_id: currentUserId }], rowCount: 1 };
      }
      if (query.includes("SELECT 1 FROM app_conversation_members")) {
        assert.deepEqual(values, [conversationId, currentUserId]);
        return { rows: [{}], rowCount: 1 };
      }
      if (query.includes("SELECT display_name, avatar FROM app_users")) {
        return { rows: [{ display_name: "Test Sender", avatar: "/sender.svg" }], rowCount: 1 };
      }
      if (query.includes("INSERT INTO app_scheduled_messages")) {
        assert.deepEqual(values.slice(0, 4), [messageId, conversationId, currentUserId, "Send this later"]);
        stored = {
          id: messageId,
          conversation_id: conversationId,
          sender_id: currentUserId,
          sender_name: "Test Sender",
          sender_avatar: "/sender.svg",
          text: "Send this later",
          metadata: JSON.parse(String(values[4])) as Record<string, unknown>,
          scheduled_for: scheduledFor,
          created_at: new Date().toISOString(),
          state: "scheduled",
        };
        return { rows: [stored], rowCount: 1 };
      }
      if (query.includes("FROM app_messages m")) {
        assert.match(query, /m\.expires_at IS NULL OR m\.expires_at > now\(\)/);
        return { rows: [], rowCount: 0 };
      }
      if (query.includes("FROM app_scheduled_messages scheduled") && query.includes("state = 'scheduled'")) {
        return { rows: stored ? [stored] : [], rowCount: stored ? 1 : 0 };
      }
      if (query.includes("UPDATE app_scheduled_messages")) {
        assert.deepEqual(values, [messageId, conversationId, currentUserId]);
        return { rows: [{ id: messageId }], rowCount: 1 };
      }
      throw new Error(`Unexpected scheduled-message database query: ${query}`);
    },
  } as unknown as Pool;

  await withServer(database, async (baseUrl) => {
    const basePath = `${baseUrl}/api/conversations/${conversationId}/scheduled-messages`;
    const createResponse = await fetch(basePath, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      },
      body: JSON.stringify({
        id: messageId,
        text: "Send this later",
        scheduledFor,
        metadata: {
          senderId: "forged-sender",
          senderName: "Forged sender",
          senderAvatar: "/forged.svg",
          replyTo: { id: "reply-1", senderName: "Teammate", text: "Original text" },
          linkPreviewDisabled: true,
        },
      }),
    });
    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json() as { message: Record<string, unknown> }).message;
    assert.equal(created.status, "scheduled");
    assert.equal(created.senderId, currentUserId);
    assert.equal(created.senderName, "Test Sender");
    assert.equal(created.scheduledFor, scheduledFor);
    assert.deepEqual(created.replyTo, { id: "reply-1", senderName: "Teammate", text: "Original text" });
    assert.equal(created.linkPreviewDisabled, true);

    const historyResponse = await fetch(
      `${baseUrl}/api/conversations/${conversationId}/messages`,
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` } },
    );
    assert.equal(historyResponse.status, 200);
    const history = (await historyResponse.json() as { messages: Array<Record<string, unknown>> }).messages;
    assert.equal(history.length, 1);
    assert.equal(history[0]?.status, "scheduled");
    assert.equal(history[0]?.senderId, currentUserId);
    assert.equal(history[0]?.linkPreviewDisabled, true);

    const cancelResponse = await fetch(`${basePath}/${messageId}`, {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
    });
    assert.equal(cancelResponse.status, 200);
    assert.deepEqual(await cancelResponse.json(), { cancelled: true });
  });
});

test("poll votes persist atomically and a single-choice vote moves between options", async () => {
  const sessionToken = randomBytes(32).toString("base64url");
  const currentUserId = "00000000-0000-4000-8000-000000000003";
  const conversationId = "00000000-0000-4000-8000-000000000001";
  const messageId = "00000000-0000-4000-8000-000000000002";
  let storedPoll = {
    question: "Choose one",
    multipleAnswers: false,
    options: [
      { id: "option-a", text: "Option A", votes: [] as string[] },
      { id: "option-b", text: "Option B", votes: [] as string[] },
    ],
  };
  const client = {
    query: async (query: string, values: unknown[] = []) => {
      if (query === "BEGIN" || query === "COMMIT" || query === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      if (query.includes("FROM app_conversation_members")) {
        return { rows: [{}], rowCount: 1 };
      }
      if (query.includes("SELECT metadata FROM app_messages")) {
        return { rows: [{ metadata: { poll: storedPoll } }], rowCount: 1 };
      }
      if (query.includes("SET metadata = jsonb_set") && query.includes("'{poll}'")) {
        assert.deepEqual(values.slice(0, 2), [messageId, conversationId]);
        storedPoll = JSON.parse(String(values[2])) as typeof storedPoll;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected poll-vote database query: ${query}`);
    },
    release: () => {},
  };
  const database = {
    query: async (query: string) => {
      if (query.includes("FROM app_sessions")) {
        return { rows: [{ user_id: currentUserId }], rowCount: 1 };
      }
      throw new Error(`Unexpected pool query: ${query}`);
    },
    connect: async () => client,
  } as unknown as Pool;

  await withServer(database, async (baseUrl) => {
    const vote = async (optionId: string) => {
      const response = await fetch(
        `${baseUrl}/api/conversations/${conversationId}/messages/${messageId}/poll-votes`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
          },
          body: JSON.stringify({ optionId }),
        },
      );
      assert.equal(response.status, 200);
      return (await response.json() as { poll: typeof storedPoll }).poll;
    };

    const firstVote = await vote("option-a");
    assert.deepEqual(firstVote.options.map(({ votes }) => votes), [[currentUserId], []]);

    const changedVote = await vote("option-b");
    assert.deepEqual(changedVote.options.map(({ votes }) => votes), [[], [currentUserId]]);
    assert.deepEqual(storedPoll, changedVote);

    storedPoll = {
      ...storedPoll,
      multipleAnswers: true,
      options: storedPoll.options.map((option) => ({ ...option, votes: [] })),
    };
    const firstMultipleVote = await vote("option-a");
    const secondMultipleVote = await vote("option-b");
    assert.deepEqual(secondMultipleVote.options.map(({ votes }) => votes), [
      [currentUserId],
      [currentUserId],
    ]);
    assert.deepEqual(storedPoll, secondMultipleVote);
    assert.deepEqual(firstMultipleVote.options.map(({ votes }) => votes), [
      [currentUserId],
      [],
    ]);
  });
});

test("readiness and conversation lock endpoints", async (t) => {
  const availablePool = {
    query: async () => ({ rows: [{ "?column?": 1 }], rowCount: 1 }),
  } as unknown as Pool;
  await withServer(availablePool, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health/ready`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ready",
      dependencies: { database: "available" },
    });
  });

  await t.test("conversation lock changes are scoped to the authenticated member", async () => {
    const sessionToken = randomBytes(32).toString("base64url");
    const userId = "00000000-0000-4000-8000-000000000001";
    const conversationId = "00000000-0000-4000-8000-000000000002";
    let membershipExists = true;
    const database = {
      query: async (query: string, values: unknown[] = []) => {
        if (query.includes("FROM app_sessions")) {
          return { rows: [{ user_id: userId }], rowCount: 1 };
        }
        if (query.includes("FROM app_conversation_members own")) {
          return {
            rows: [{
              id: conversationId,
              type: "direct",
              current_user_role: "member",
              is_locked: true,
              name: "Private conversation",
              description: null,
              avatar: null,
              peer_user_id: null,
              peer_name: null,
              peer_avatar: null,
              peer_phone: null,
              members: null,
              last_message_id: null,
              last_message_conversation_id: null,
              last_message_sender_id: null,
              last_message_sender_name: null,
              last_message_sender_avatar: null,
              last_message_text: null,
              last_message_attachments: null,
              last_message_voice_note: null,
              last_message_status: null,
              last_message_metadata: null,
              last_message_created_at: null,
              updated_at: new Date().toISOString(),
            }],
            rowCount: 1,
          };
        }
        if (query.includes("UPDATE app_conversation_members") && query.includes("SET is_locked")) {
          assert.deepEqual(values.slice(0, 2), [conversationId, userId]);
          return membershipExists
            ? { rows: [{ is_locked: values[2] }], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected conversation lock query: ${query}`);
      },
    } as unknown as Pool;

    await withServer(database, async (baseUrl) => {
      const listResponse = await fetch(
        `${baseUrl}/api/conversations`,
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` } },
      );
      assert.equal(listResponse.status, 200);
      const listResult = await listResponse.json() as { conversations: Array<{ id: string; isLocked: boolean }> };
      assert.deepEqual(listResult.conversations, [
        {
          id: conversationId,
          type: "direct",
          name: "Private conversation",
          description: "",
          avatar: "",
          currentUserRole: "member",
          isLocked: true,
          unreadCount: 0,
          updatedAt: listResult.conversations[0]?.updatedAt,
        },
      ]);

      const updateLock = (isLocked: boolean) => fetch(
        `${baseUrl}/api/conversations/${conversationId}/lock`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
          },
          body: JSON.stringify({ isLocked }),
        },
      );

      const lockResponse = await updateLock(true);
      assert.equal(lockResponse.status, 200);
      assert.deepEqual(await lockResponse.json(), { isLocked: true });

      const unlockResponse = await updateLock(false);
      assert.equal(unlockResponse.status, 200);
      assert.deepEqual(await unlockResponse.json(), { isLocked: false });

      membershipExists = false;
      const notMemberResponse = await updateLock(true);
      assert.equal(notMemberResponse.status, 404);
      assert.equal(
        (await notMemberResponse.json() as { error: { code: string } }).error.code,
        "CONVERSATION_NOT_FOUND",
      );
    });
  });

  const unavailablePool = { query: async () => { throw new Error("private connection detail"); } } as unknown as Pool;
  await withServer(unavailablePool, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health/ready`);
    assert.equal(response.status, 503);
    const payload = await response.text();
    assert.match(payload, /"unavailable"/);
    assert.doesNotMatch(payload, /private connection detail/);
  });
});

test("unknown API routes use consistent sanitized errors", async () => {
  await withServer(undefined, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/not-a-route`);
    assert.equal(response.status, 404);
    const body = await response.json() as { error: { code: string; message: string; requestId: string } };
    assert.equal(body.error.code, "NOT_FOUND");
    assert.equal(body.error.message, "No route for GET /api/not-a-route.");
    assert.ok(body.error.requestId);
  });
});

test("JSON parser rejects oversized request bodies", async () => {
  await withServer(undefined, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health/live`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: "x".repeat(6 * 1024 * 1024) }),
    });
    assert.equal(response.status, 413);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, "PAYLOAD_TOO_LARGE");
  });
});

test("malformed JSON receives a client error rather than an internal error", async () => {
  await withServer(undefined, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health/live`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid",
    });
    assert.equal(response.status, 400);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, "INVALID_JSON");
  });
});

test("supports configurable CORS origins and preflight requests", async () => {
  const corsOrigin = "https://connectsphere.example.com";
  await withServer(
    undefined,
    async (baseUrl) => {
      // Preflight OPTIONS
      const preflight = await fetch(`${baseUrl}/api/health/live`, {
        method: "OPTIONS",
        headers: {
          origin: corsOrigin,
          "access-control-request-method": "GET",
        },
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get("access-control-allow-origin"), corsOrigin);
      assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");

      // Actual request
      const response = await fetch(`${baseUrl}/api/health/live`, {
        headers: { origin: corsOrigin },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("access-control-allow-origin"), corsOrigin);
    },
    { corsOrigin },
  );
});

test("serves frontend static assets and Single Page Application fallback when configured", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "cs-static-"));
  try {
    await mkdir(join(tempDir, "assets"), { recursive: true });
    await writeFile(join(tempDir, "index.html"), "<html><body>ConnectSphere SPA</body></html>");
    await writeFile(join(tempDir, "assets", "bundle.js"), "console.log('bundle');");

    await withServer(
      undefined,
      async (baseUrl) => {
        // Root serves index.html
        const rootRes = await fetch(`${baseUrl}/`);
        assert.equal(rootRes.status, 200);
        assert.equal(rootRes.headers.get("cache-control"), "no-cache");
        const rootHtml = await rootRes.text();
        assert.match(rootHtml, /ConnectSphere SPA/);

        // SPA route serves index.html
        const spaRes = await fetch(`${baseUrl}/chats/active-call`);
        assert.equal(spaRes.status, 200);
        const spaHtml = await spaRes.text();
        assert.match(spaHtml, /ConnectSphere SPA/);

        // Static asset in /assets has cache-control
        const assetRes = await fetch(`${baseUrl}/assets/bundle.js`);
        assert.equal(assetRes.status, 200);
        assert.match(assetRes.headers.get("cache-control") ?? "", /max-age=31536000/);

        // API route still works
        const apiRes = await fetch(`${baseUrl}/api/health/live`);
        assert.equal(apiRes.status, 200);

        // API 404 is still JSON error, not SPA
        const notFoundRes = await fetch(`${baseUrl}/api/unknown-endpoint`);
        assert.equal(notFoundRes.status, 404);
        const errJson = await notFoundRes.json() as { error: { code: string } };
        assert.equal(errJson.error.code, "NOT_FOUND");
      },
      { staticDir: tempDir },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("streams attachments larger than 10 MB to storage and serves them to conversation members", async () => {
  const sessionToken = randomBytes(32).toString("base64url");
  const userId = "00000000-0000-4000-8000-000000000001";
  const conversationId = "00000000-0000-4000-8000-000000000002";
  const attachmentId = "00000000-0000-4000-8000-000000000003";
  const objects = new Map<string, { bytes: Buffer; metadata: Record<string, string>; contentType: string }>();
  const storage: R2AttachmentStorage = {
    async uploadObject(key, body, contentType, metadata) {
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk));
      objects.set(key, { bytes: Buffer.concat(chunks), metadata, contentType });
    },
    async headObject(key) {
      const object = objects.get(key);
      if (!object) throw new Error("Missing test object");
      return { contentLength: object.bytes.length, contentType: object.contentType, metadata: object.metadata };
    },
    async getObject(key) {
      const object = objects.get(key);
      if (!object) throw new Error("Missing test object");
      return {
        body: Readable.from([object.bytes]),
        contentLength: object.bytes.length,
        contentType: object.contentType,
      };
    },
    async deleteObject(key) {
      objects.delete(key);
    },
  };
  const database = {
    query: async (query: string) => {
      if (query.includes("SELECT user_id FROM app_sessions")) return { rows: [{ user_id: userId }], rowCount: 1 };
      if (query.includes("SELECT 1 FROM app_conversation_members")) return { rows: [{}], rowCount: 1 };
      throw new Error(`Unexpected attachment database query: ${query}`);
    },
  } as unknown as Pool;
  const payload = Buffer.alloc(10 * 1024 * 1024 + 1, 0x5a);
  const key = `attachments/${conversationId}/${attachmentId}`;

  await withServer(database, async (baseUrl) => {
    const upload = await fetch(`${baseUrl}/api/conversations/${conversationId}/attachments/${attachmentId}`, {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
        "content-type": "application/octet-stream",
        "x-attachment-type": "file",
        "x-file-name": "large.bin",
        "x-file-content-type": "application/octet-stream",
      },
      body: payload,
    });
    assert.equal(upload.status, 201);
    const uploadBody = await upload.json() as { attachment: { sizeBytes: number; storage: string } };
    assert.equal(uploadBody.attachment.sizeBytes, payload.length);
    assert.equal(uploadBody.attachment.storage, "r2");
    assert.equal(objects.get(key)?.bytes.length, payload.length);

    const download = await fetch(`${baseUrl}/api/conversations/${conversationId}/attachments/${attachmentId}`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
    });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-length"), String(payload.length));
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), payload);
  }, { attachmentStorage: storage });
});

test("deleting a message removes its R2 object and broadcasts deletion after database removal", async () => {
  const sessionToken = randomBytes(32).toString("base64url");
  const userId = "00000000-0000-4000-8000-000000000001";
  const conversationId = "00000000-0000-4000-8000-000000000002";
  const messageId = "00000000-0000-4000-8000-000000000003";
  const attachmentId = "00000000-0000-4000-8000-000000000004";
  const statements: string[] = [];
  const deletedKeys: string[] = [];
  let deletionNotice: { messageId: string; conversationId: string; deletedBy: string; ghostUnsend?: boolean } | undefined;
  const storage: R2AttachmentStorage = {
    async uploadObject() {},
    async headObject() {
      throw new Error("Unexpected attachment metadata lookup");
    },
    async getObject() {
      throw new Error("Unexpected attachment download");
    },
    async deleteObject(key) {
      deletedKeys.push(key);
    },
  };
  const database = {
    query: async (query: string) => {
      statements.push(query);
      if (query.includes("SELECT user_id FROM app_sessions")) return { rows: [{ user_id: userId }], rowCount: 1 };
      if (query.includes("SELECT 1 FROM app_conversation_members")) return { rows: [{}], rowCount: 1 };
      if (query.includes("SELECT sender_id, attachments FROM app_messages")) {
        return {
          rows: [{
            sender_id: userId,
            attachments: [{ id: attachmentId, storage: "r2" }],
          }],
          rowCount: 1,
        };
      }
      if (query.includes("DELETE FROM app_messages")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected deletion database query: ${query}`);
    },
  } as unknown as Pool;

  await withServer(database, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages/${messageId}`, {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { deleted: true, ghostUnsend: true });
    assert.deepEqual(deletedKeys, [`attachments/${conversationId}/${attachmentId}`]);
    assert.ok(statements.some((query) => query.includes("DELETE FROM app_messages")));
    assert.deepEqual(deletionNotice, {
      messageId,
      conversationId,
      deletedBy: userId,
      ghostUnsend: true,
    });
  }, {
    attachmentStorage: storage,
    notifyMessageDeleted: async (payload) => {
      deletionNotice = payload;
    },
  });
});

test("rejects an R2 attachment reference owned by another conversation", async () => {
  const sessionToken = randomBytes(32).toString("base64url");
  const userId = "00000000-0000-4000-8000-000000000001";
  const conversationId = "00000000-0000-4000-8000-000000000002";
  const otherConversationId = "00000000-0000-4000-8000-000000000003";
  const messageId = "00000000-0000-4000-8000-000000000004";
  const attachmentId = "00000000-0000-4000-8000-000000000005";
  let updated = false;
  let lookedUpKey = "";
  const storage: R2AttachmentStorage = {
    async uploadObject() {},
    async headObject(key) {
      lookedUpKey = key;
      return {
        metadata: { conversationid: otherConversationId, attachmentid: attachmentId },
      };
    },
    async getObject() {
      throw new Error("Unexpected attachment download");
    },
    async deleteObject() {},
  };
  const database = {
    query: async (query: string) => {
      if (query.includes("SELECT user_id FROM app_sessions")) return { rows: [{ user_id: userId }], rowCount: 1 };
      if (query.includes("SELECT 1 FROM app_conversation_members")) return { rows: [{}], rowCount: 1 };
      if (query.includes("SELECT sender_id, text, attachments")) {
        return { rows: [{ sender_id: userId, text: "Existing", attachments: [] }], rowCount: 1 };
      }
      if (query.includes("SET text = COALESCE")) {
        updated = true;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected attachment reference database query: ${query}`);
    },
  } as unknown as Pool;

  await withServer(database, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/conversations/${conversationId}/messages/${messageId}`,
      {
        method: "PATCH",
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          attachments: [{
            id: attachmentId,
            storage: "r2",
            type: "file",
            name: "foreign.txt",
            size: "1 B",
            url: "",
          }],
        }),
      },
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json() as { error: { code: string } }).error.code, "ATTACHMENT_ACCESS_DENIED");
    assert.equal(lookedUpKey, `attachments/${conversationId}/${attachmentId}`);
    assert.equal(updated, false);
  }, { attachmentStorage: storage });
});

test("forwards R2 attachments into a new conversation-scoped object", async () => {
  const sessionToken = randomBytes(32).toString("base64url");
  const userId = "00000000-0000-4000-8000-000000000001";
  const sourceConversationId = "00000000-0000-4000-8000-000000000002";
  const targetConversationId = "00000000-0000-4000-8000-000000000003";
  const messageId = "00000000-0000-4000-8000-000000000004";
  const attachmentId = "00000000-0000-4000-8000-000000000005";
  const bytes = Buffer.from("forwarded file");
  const objects = new Map<string, { bytes: Buffer; metadata: Record<string, string>; contentType: string }>([
    [`attachments/${sourceConversationId}/${attachmentId}`, {
      bytes,
      metadata: {
        conversationid: sourceConversationId,
        attachmentid: attachmentId,
        attachmenttype: "file",
      },
      contentType: "text/plain",
    }],
  ]);
  let savedAttachments: Array<{ id: string; url: string }> = [];
  const storage: R2AttachmentStorage = {
    async uploadObject(key, body, contentType, metadata) {
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk));
      objects.set(key, { bytes: Buffer.concat(chunks), metadata, contentType });
    },
    async headObject(key) {
      const object = objects.get(key);
      if (!object) throw new Error("Missing test object");
      return { contentLength: object.bytes.length, contentType: object.contentType, metadata: object.metadata };
    },
    async getObject(key) {
      const object = objects.get(key);
      if (!object) throw new Error("Missing test object");
      return {
        body: Readable.from([object.bytes]),
        contentLength: object.bytes.length,
        contentType: object.contentType,
      };
    },
    async deleteObject(key) {
      objects.delete(key);
    },
  };
  const database = {
    query: async (query: string, values: unknown[] = []) => {
      if (query.includes("SELECT user_id FROM app_sessions")) return { rows: [{ user_id: userId }], rowCount: 1 };
      if (query.includes("SELECT 1 FROM app_conversation_members")) {
        assert.ok([sourceConversationId, targetConversationId].includes(values[0] as string));
        return { rows: [{}], rowCount: 1 };
      }
      if (query.includes("SELECT sender_id, text, attachments")) {
        return { rows: [{ sender_id: userId, text: "Forwarded", attachments: [] }], rowCount: 1 };
      }
      if (query.includes("SET text = COALESCE")) {
        savedAttachments = JSON.parse(String(values[3])) as Array<{ id: string; url: string }>;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected attachment forwarding database query: ${query}`);
    },
  } as unknown as Pool;

  await withServer(database, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/conversations/${targetConversationId}/messages/${messageId}`,
      {
        method: "PATCH",
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          attachments: [{
            id: attachmentId,
            storage: "r2",
            type: "file",
            name: "forwarded.txt",
            size: "14 B",
            url: `/api/conversations/${sourceConversationId}/attachments/${attachmentId}`,
          }],
        }),
      },
    );
    assert.equal(response.status, 200);
    assert.equal(savedAttachments.length, 1);
    const savedAttachment = savedAttachments[0]!;
    assert.notEqual(savedAttachment.id, attachmentId);
    assert.equal(savedAttachment.url, `/api/conversations/${targetConversationId}/attachments/${savedAttachment.id}`);
    assert.deepEqual(
      objects.get(`attachments/${targetConversationId}/${savedAttachment.id}`)?.bytes,
      bytes,
    );
  }, { attachmentStorage: storage });
});
