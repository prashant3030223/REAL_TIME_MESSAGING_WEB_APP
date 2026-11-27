import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import pino from "pino";
import { WebSocket } from "ws";
import type { Pool } from "pg";
import { createApp } from "../../apps/api/src/app.js";
import { createRealtimeGateway, type RealtimeMessage } from "../../apps/api/src/realtime.js";
import { SESSION_COOKIE_NAME } from "../../apps/api/src/auth.js";
import type { PushNotificationPayload } from "../../apps/api/src/push.js";

async function withRealtimeServer(
  run: (wsUrl: string) => Promise<void>,
  database?: Pool,
  notifyPushToUser?: (userId: string, payload: PushNotificationPayload) => Promise<void>,
) {
  const logger = pino({ enabled: false });
  const app = createApp({ logger });
  const server = createServer(app);
  const gateway = createRealtimeGateway(server, logger, database, undefined, notifyPushToUser);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const wsUrl = `ws://127.0.0.1:${address.port}/ws`;

  try {
    await run(wsUrl);
  } finally {
    gateway.shutdown();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function createConnectedClient(wsUrl: string, sessionToken?: string) {
  const ws = new WebSocket(wsUrl, sessionToken
    ? { headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` } }
    : undefined);
  const messages: any[] = [];
  const waiting: { predicate: (msg: any) => boolean; resolve: (msg: any) => void }[] = [];

  ws.on("message", (data) => {
    try {
      const parsed = JSON.parse(data.toString());
      messages.push(parsed);
      for (let i = waiting.length - 1; i >= 0; i--) {
        const item = waiting[i];
        if (item && item.predicate(parsed)) {
          item.resolve(parsed);
          waiting.splice(i, 1);
        }
      }
    } catch {}
  });

  const waitFor = (predicate: (msg: any) => boolean, timeoutMs = 3000): Promise<any> => {
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timed out waiting for WebSocket message"));
      }, timeoutMs);
      waiting.push({
        predicate,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      });
    });
  };

  const openPromise = new Promise<void>((resolve) => ws.on("open", () => resolve()));

  return {
    ws,
    openPromise,
    waitFor,
    hasMessage: (predicate: (msg: any) => boolean) => messages.some(predicate),
  };
}

test("WebSocket clients receive connection:ack and presence updates", async () => {
  await withRealtimeServer(async (wsUrl) => {
    const c1 = createConnectedClient(wsUrl);
    const c2 = createConnectedClient(wsUrl);

    await Promise.all([c1.openPromise, c2.openPromise]);

    const ack1 = await c1.waitFor((m) => m.type === "connection:ack");
    const ack2 = await c2.waitFor((m) => m.type === "connection:ack");
    assert.ok(ack1.payload.clientId);
    assert.ok(ack2.payload.clientId);

    // Client 1 identifies as Dr. Sarah Chen
    const presencePromise = c2.waitFor((m) => m.type === "presence:update");

    c1.ws.send(JSON.stringify({
      type: "identify",
      payload: {
        userId: "user-sarah",
        username: "sarah",
        displayName: "Dr. Sarah Chen",
      },
    }));

    const presence = await presencePromise;
    assert.equal(presence.type, "presence:update");
    assert.ok(presence.payload.onlineUsers.some((u: any) => u.userId === "user-sarah"));

    const offlinePresencePromise = c2.waitFor(
      (message) => message.type === "presence:update" &&
        !message.payload.onlineUsers.some((user: any) => user.userId === "user-sarah")
    );
    c1.ws.close();
    const offlinePresence = await offlinePresencePromise;
    assert.ok(!offlinePresence.payload.onlineUsers.some((u: any) => u.userId === "user-sarah"));
    c2.ws.close();
  });
});

test("WebSocket relays chat messages, echoes delivery receipts, and forwards WebRTC signals", async () => {
  await withRealtimeServer(async (wsUrl) => {
    const c1 = createConnectedClient(wsUrl);
    const c2 = createConnectedClient(wsUrl);

    await Promise.all([c1.openPromise, c2.openPromise]);

    const typingPromise = c2.waitFor((m) =>
      m.type === "chat:typing" && m.payload.conversationId === "conv-1" && m.payload.isTyping
    );
    c1.ws.send(JSON.stringify({
      type: "chat:typing",
      conversationId: "conv-1",
      payload: {
        conversationId: "conv-1",
        isTyping: true,
        user: { id: "client1-user", displayName: "Sender" },
      },
    }));
    const typingEvent = await typingPromise;
    assert.equal(typingEvent.payload.user.displayName, "Sender");
    const stoppedTypingPromise = c2.waitFor((m) =>
      m.type === "chat:typing" && m.payload.conversationId === "conv-1" && !m.payload.isTyping
    );
    c1.ws.send(JSON.stringify({
      type: "chat:typing",
      conversationId: "conv-1",
      payload: {
        conversationId: "conv-1",
        isTyping: false,
        user: { id: "client1-user", displayName: "Sender" },
      },
    }));
    const stoppedTypingEvent = await stoppedTypingPromise;
    assert.equal(stoppedTypingEvent.payload.isTyping, false);

    // 1. Chat message exchange
    const deliveredPromise = c1.waitFor((m) => m.type === "chat:delivered");
    const peerReceivePromise = c2.waitFor((m) => m.type === "chat:message");

    const testMsg = {
      id: "msg-realtime-test-1",
      conversationId: "conv-1",
      text: "Real-time WebRTC and PCR test",
      senderId: "client1-user",
    };

    c1.ws.send(JSON.stringify({
      type: "chat:message",
      conversationId: "conv-1",
      payload: testMsg,
    }));

    const [delivered, received] = await Promise.all([deliveredPromise, peerReceivePromise]);
    assert.equal(delivered.payload.messageId, "msg-realtime-test-1");
    assert.equal(delivered.payload.status, "delivered");
    assert.equal(received.payload.text, "Real-time WebRTC and PCR test");

    const readReceiptPromise = c1.waitFor((m) =>
      m.type === "chat:read" && m.payload.messageIds?.includes("msg-realtime-test-1")
    );
    c2.ws.send(JSON.stringify({
      type: "chat:read",
      conversationId: "conv-1",
      payload: { messageIds: ["msg-realtime-test-1"] },
    }));
    const readReceipt = await readReceiptPromise;
    assert.deepEqual(readReceipt.payload.messageIds, ["msg-realtime-test-1"]);

    // 2. WebRTC signal relay
    const signalPromise = c2.waitFor((m) => m.type === "webrtc:signal");

    c1.ws.send(JSON.stringify({
      type: "webrtc:signal",
      callId: "call-xyz",
      payload: { signal: { sdp: { type: "offer", sdp: "dummy-sdp-test" } } },
    }));

    const signal = await signalPromise;
    assert.equal(signal.callId, "call-xyz");
    assert.equal(signal.payload.signal.sdp.type, "offer");

    // Call readiness and acceptance are scoped to the same call identifier.
    const readyPromise = c1.waitFor((m) => m.type === "call:ready" && m.payload.callId === "call-xyz");
    c2.ws.send(JSON.stringify({
      type: "call:ready",
      callId: "call-xyz",
      payload: { callId: "call-xyz" },
    }));
    const ready = await readyPromise;
    assert.equal(ready.payload.callId, "call-xyz");

    const acceptPromise = c1.waitFor((m) => m.type === "call:accept" && m.payload.callId === "call-xyz");
    c2.ws.send(JSON.stringify({
      type: "call:accept",
      callId: "call-xyz",
      payload: { callId: "call-xyz" },
    }));
    const accepted = await acceptPromise;
    assert.equal(accepted.payload.callId, "call-xyz");

    // 3. Collaborative Whiteboard and Notes
    const strokePromise = c2.waitFor((m) => m.type === "whiteboard:stroke");
    c1.ws.send(JSON.stringify({
      type: "whiteboard:stroke",
      payload: { points: [{ x: 10, y: 20 }], color: "#10b981", width: 3 },
    }));
    const stroke = await strokePromise;
    assert.equal(stroke.payload.color, "#10b981");

    // 4. Real-time Telemetry PCR Estimator Evaluation
    const estimatePromise = c1.waitFor((m) => m.type === "telemetry:estimate");
    c1.ws.send(JSON.stringify({
      type: "telemetry:sample",
      payload: {
        sample: {
          timestampMs: Date.now(),
          roundTripTimeMs: 35,
          jitterMs: 4,
          packetLossPercent: 0,
          availableOutgoingBitrateBps: 3_200_000,
        },
      },
    }));
    const estMsg = await estimatePromise;
    assert.ok(estMsg.payload.estimate);
    assert.ok(["UNKNOWN", "NORMAL", "ELEVATED", "HIGH", "CRITICAL"].includes(estMsg.payload.estimate.level));

    c1.ws.close();
    c2.ws.close();
  });
});

test("WebSocket relays live workspace collaboration events to other clients", async () => {
  await withRealtimeServer(async (wsUrl) => {
    const sender = createConnectedClient(wsUrl);
    const receiver = createConnectedClient(wsUrl);
    await Promise.all([sender.openPromise, receiver.openPromise]);

    const eventTypes = [
      "whiteboard:stroke",
      "whiteboard:clear",
      "collab:notes",
      "collab:task",
    ];
    const received = eventTypes.map((type) =>
      receiver.waitFor((message) => message.type === type)
    );

    sender.ws.send(JSON.stringify({
      type: "whiteboard:stroke",
      payload: {
        points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }],
        normalized: true,
        color: "#10b981",
        width: 0.005,
        tool: "pen",
      },
    }));
    sender.ws.send(JSON.stringify({ type: "whiteboard:clear", payload: {} }));
    sender.ws.send(JSON.stringify({ type: "collab:notes", payload: { content: "Updated notes" } }));
    sender.ws.send(JSON.stringify({ type: "collab:task", payload: { taskId: "task-1", completed: true } }));

    const messages = await Promise.all(received);
    assert.deepEqual(messages.map((message) => message.type), eventTypes);
    assert.equal(messages[0].payload.normalized, true);
    assert.equal(messages[2].payload.content, "Updated notes");
    assert.equal(messages[3].payload.completed, true);
    sender.ws.close();
    receiver.ws.close();
  });
});

test("authenticated call signaling is routed only to participants, including phone-only targets", async () => {
  const tokenUsers = new Map<string, string>();
  const profiles = new Map([
    ["caller-user", { username: "caller", display_name: "Caller", avatar: null, phone: "+15551230001" }],
    ["callee-user", { username: "callee", display_name: "Callee", avatar: null, phone: "+15551230002" }],
    ["other-user", { username: "other", display_name: "Other", avatar: null, phone: "+15551230003" }],
    ["outsider-user", { username: "outsider", display_name: "Outsider", avatar: null, phone: "+15551230004" }],
  ]);
  const extraUserIds = Array.from({ length: 7 }, (_, index) => `extra-user-${index + 1}`);
  const overflowUserId = "overflow-user";
  for (const [index, userId] of [...extraUserIds, overflowUserId].entries()) {
    profiles.set(userId, {
      username: userId,
      display_name: `Participant ${index + 1}`,
      avatar: null,
      phone: `+155512301${String(index).padStart(2, "0")}`,
    });
  }
  const database = {
    query: async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT user_id FROM app_sessions")) {
        const tokenHash = (values[0] as Buffer).toString("hex");
        const userId = tokenUsers.get(tokenHash);
        return { rows: userId ? [{ user_id: userId }] : [] };
      }
      if (sql.includes("SELECT username, display_name, avatar, phone FROM app_users")) {
        const profile = profiles.get(String(values[0]));
        return { rows: profile ? [profile] : [] };
      }
      if (sql.includes("right(regexp_replace(COALESCE(phone")) {
        const targetPhone = String(values[0]);
        const match = [...profiles.entries()].find(([, profile]) =>
          profile.phone?.replace(/\D/g, "").endsWith(targetPhone)
        );
        return { rows: match ? [{ id: match[0] }] : [] };
      }
      if (sql.includes("UPDATE app_messages m")) {
        return { rows: (values[0] as string[]).map((id) => ({ id })) };
      }
      if (sql.includes("SELECT member.user_id, conversation.type")) {
        return {
          rows: [
            { user_id: "caller-user", type: "direct" },
            { user_id: "callee-user", type: "direct" },
          ],
        };
      }
      if (sql.includes("SELECT user_id FROM app_conversation_members")) {
        return { rows: [{ user_id: "caller-user" }, { user_id: "callee-user" }] };
      }
      if (sql.includes("FROM app_user_connections connection")) {
        return { rows: [{ connected: true }] };
      }
      throw new Error(`Unexpected realtime test database query: ${sql}`);
    },
  } as unknown as Pool;

  const makeToken = (userId: string) => {
    const token = randomBytes(32).toString("base64url");
    tokenUsers.set(createHash("sha256").update(token).digest("hex"), userId);
    return token;
  };

  await withRealtimeServer(async (wsUrl) => {
    const caller = createConnectedClient(wsUrl, makeToken("caller-user"));
    const callee = createConnectedClient(wsUrl, makeToken("callee-user"));
    const unrelated = createConnectedClient(wsUrl, makeToken("other-user"));
    const outsider = createConnectedClient(wsUrl, makeToken("outsider-user"));
    const extraClients = extraUserIds.map((userId) => createConnectedClient(wsUrl, makeToken(userId)));
    const overflowClient = createConnectedClient(wsUrl, makeToken(overflowUserId));
    const allClients = [caller, callee, unrelated, outsider, ...extraClients, overflowClient];
    await Promise.all(allClients.map(({ openPromise }) => openPromise));

    await Promise.all([
      ...allClients.map((connectedClient) =>
        connectedClient.waitFor((message) => message.type === "presence:update" && message.payload.onlineUsers.length === 12)
      ),
    ]);

    const callId = "phone-targeted-call";
    const invitePromise = callee.waitFor((message) => message.type === "call:invite" && message.callId === callId);
    const ringingPromise = caller.waitFor((message) => message.type === "call:ringing" && message.callId === callId);
    caller.ws.send(JSON.stringify({
      type: "call:invite",
      callId,
      payload: {
        callId,
        targetPhone: "5551230002",
        peerName: "Recipient's name shown on caller device",
        fromUser: { id: "spoofed-user", displayName: "Spoofed caller" },
        isVideo: true,
      },
    }));
    const [invite] = await Promise.all([invitePromise, ringingPromise]);
    assert.equal(invite.payload.fromUser.id, "caller-user");
    assert.equal(invite.payload.fromUser.displayName, "Caller");
    assert.equal(invite.payload.peerName, "Recipient's name shown on caller device");

    callee.ws.send(JSON.stringify({
      type: "call:chat",
      callId,
      payload: {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        text: "Call has not been accepted yet",
      },
    }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(callee.hasMessage((message) => message.type === "call:chat"), false);

    const acceptPromise = caller.waitFor((message) => message.type === "call:accept" && message.callId === callId);
    callee.ws.send(JSON.stringify({ type: "call:accept", callId, payload: { callId } }));
    await acceptPromise;

    const participantAddedPromise = caller.waitFor((message) =>
      message.type === "call:participant-invited" &&
      message.callId === callId &&
      message.payload.participant.id === "other-user"
    );
    const addedInvitePromise = unrelated.waitFor((message) =>
      message.type === "call:invite" && message.callId === callId && message.payload.groupInvite
    );
    callee.ws.send(JSON.stringify({
      type: "call:add-participant",
      callId,
      payload: { targetUserId: "other-user", isVideo: true },
    }));
    const [participantAdded, addedInvite] = await Promise.all([participantAddedPromise, addedInvitePromise]);
    assert.equal(participantAdded.payload.participant.displayName, "Other");
    assert.equal(addedInvite.payload.fromUser.id, "callee-user");

    const groupSnapshotPromise = caller.waitFor((message) =>
      message.type === "call:participants" &&
      message.callId === callId &&
      message.payload.participants.some((participant: { id: string }) => participant.id === "other-user")
    );
    unrelated.ws.send(JSON.stringify({ type: "call:accept", callId, payload: { callId } }));
    const groupSnapshot = await groupSnapshotPromise;
    assert.deepEqual(
      groupSnapshot.payload.participants.map((participant: { id: string }) => participant.id).sort(),
      ["callee-user", "caller-user", "other-user"],
    );

    for (const [index, participantClient] of extraClients.entries()) {
      const targetUserId = extraUserIds[index];
      assert.ok(targetUserId);
      const invitePromise = participantClient.waitFor((message) =>
        message.type === "call:invite" && message.callId === callId && message.payload.groupInvite
      );
      callee.ws.send(JSON.stringify({
        type: "call:add-participant",
        callId,
        payload: { targetUserId, isVideo: true },
      }));
      await invitePromise;

      const participantSnapshotPromise = caller.waitFor((message) =>
        message.type === "call:participants" &&
        message.callId === callId &&
        message.payload.participants.some((participant: { id: string }) => participant.id === targetUserId)
      );
      participantClient.ws.send(JSON.stringify({ type: "call:accept", callId, payload: { callId } }));
      await participantSnapshotPromise;
    }

    const capacityErrorPromise = callee.waitFor((message) =>
      message.type === "call:add-participant:error" &&
      message.callId === callId &&
      message.payload.reason.includes("10-person")
    );
    callee.ws.send(JSON.stringify({
      type: "call:add-participant",
      callId,
      payload: { targetUserId: overflowUserId, isVideo: true },
    }));
    await capacityErrorPromise;
    assert.equal(
      overflowClient.hasMessage((message) => message.type === "call:invite" && message.callId === callId),
      false,
    );

    const callStrokeCallerPromise = caller.waitFor((message) =>
      message.type === "whiteboard:stroke" && message.callId === callId
    );
    const callStrokeGroupPromise = unrelated.waitFor((message) =>
      message.type === "whiteboard:stroke" && message.callId === callId
    );
    callee.ws.send(JSON.stringify({
      type: "whiteboard:stroke",
      callId,
      payload: { points: [{ x: 0.1, y: 0.2 }], color: "#10b981", width: 3 },
    }));
    await Promise.all([callStrokeCallerPromise, callStrokeGroupPromise]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(outsider.hasMessage((message) => message.type === "whiteboard:stroke" && message.callId === callId), false);

    const readyPromise = caller.waitFor((message) => message.type === "call:ready" && message.callId === callId);
    callee.ws.send(JSON.stringify({ type: "call:ready", callId, payload: { callId } }));
    const ready: RealtimeMessage = await readyPromise;
    assert.equal(ready.payload?.fromUserId, "callee-user");

    const signalPromise = caller.waitFor((message) =>
      message.type === "webrtc:signal" &&
      message.callId === callId &&
      message.payload.toUserId === "caller-user"
    );
    callee.ws.send(JSON.stringify({
      type: "webrtc:signal",
      callId,
      payload: {
        callId,
        toUserId: "caller-user",
        signal: { candidate: { candidate: "candidate:1", sdpMid: "0" } },
      },
    }));
    const signal = await signalPromise;
    assert.equal(signal.payload.fromUserId, "callee-user");

    const callChatPromise = callee.waitFor((message) =>
      message.type === "call:chat" && message.callId === callId
    );
    const groupChatPromise = unrelated.waitFor((message) =>
      message.type === "call:chat" && message.callId === callId
    );
    caller.ws.send(JSON.stringify({
      type: "call:chat",
      callId,
      payload: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        text: "Ephemeral call message",
        senderId: "spoofed-user",
        senderName: "Spoofed sender",
      },
    }));
    const [callChat, groupChat] = await Promise.all([callChatPromise, groupChatPromise]);
    assert.equal(callChat.payload.senderId, "caller-user");
    assert.equal(callChat.payload.senderName, "Caller");
    assert.equal(callChat.payload.text, "Ephemeral call message");
    assert.equal(groupChat.payload.id, callChat.payload.id);

    outsider.ws.send(JSON.stringify({
      type: "call:chat",
      callId,
      payload: {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        text: "Should not be routed",
      },
    }));

    const messageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const readReceiptPromise = caller.waitFor((message) =>
      message.type === "chat:read" && message.payload.messageIds?.includes(messageId)
    );
    callee.ws.send(JSON.stringify({
      type: "chat:read",
      conversationId: "conversation-1",
      payload: { messageIds: [messageId] },
    }));
    const readReceipt = await readReceiptPromise;
    assert.deepEqual(readReceipt.payload.messageIds, [messageId]);
    assert.equal(readReceipt.payload.status, "read");

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(outsider.hasMessage((message) => message.callId === callId), false);
    assert.equal(caller.hasMessage((message) => message.type === "call:chat" && message.payload?.text === "Should not be routed"), false);
    caller.ws.close();
    callee.ws.close();
    unrelated.ws.close();
    outsider.ws.close();
    for (const participantClient of extraClients) participantClient.ws.close();
    overflowClient.ws.close();
  }, database);
});

test("offline call invitations send push alerts and replay when the recipient reconnects", async () => {
  const callerId = "00000000-0000-4000-8000-000000000101";
  const recipientId = "00000000-0000-4000-8000-000000000102";
  const tokenUsers = new Map<string, string>();
  const profiles = new Map([
    [callerId, { username: "caller", display_name: "Caller", avatar: null, phone: null }],
    [recipientId, { username: "recipient", display_name: "Recipient", avatar: null, phone: null }],
  ]);
  const makeToken = (userId: string) => {
    const token = randomBytes(32).toString("base64url");
    tokenUsers.set(createHash("sha256").update(token).digest("hex"), userId);
    return token;
  };
  const database = {
    query: async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT user_id FROM app_sessions")) {
        const tokenHash = (values[0] as Buffer).toString("hex");
        const userId = tokenUsers.get(tokenHash);
        return { rows: userId ? [{ user_id: userId }] : [] };
      }
      if (sql.includes("SELECT username, display_name, avatar, phone FROM app_users")) {
        const profile = profiles.get(String(values[0]));
        return { rows: profile ? [profile] : [] };
      }
      if (sql.includes("SELECT id FROM app_users WHERE id = $1")) {
        const userId = String(values[0]);
        return { rows: profiles.has(userId) ? [{ id: userId }] : [] };
      }
      if (sql.includes("FROM app_user_connections connection")) {
        return { rows: [{ connected: true }] };
      }
      throw new Error(`Unexpected offline-call test database query: ${sql}`);
    },
  } as unknown as Pool;
  const sentPushes: Array<{ userId: string; payload: PushNotificationPayload }> = [];
  const callId = "00000000-0000-4000-8000-000000000103";

  await withRealtimeServer(async (wsUrl) => {
    const caller = createConnectedClient(wsUrl, makeToken(callerId));
    await caller.openPromise;
    await caller.waitFor((message) => message.type === "connection:ack");
    caller.ws.send(JSON.stringify({
      type: "call:invite",
      callId,
      payload: { callId, targetUserId: recipientId, isVideo: false },
    }));

    await caller.waitFor((message) => message.type === "call:ringing" && message.callId === callId);
    assert.deepEqual(sentPushes, [{
      userId: recipientId,
      payload: {
        type: "call",
        title: "Incoming voice call",
        body: "Caller is calling you",
        url: "/",
        callId,
        isVideo: false,
        tag: `call-${callId}`,
      },
    }]);

    const recipient = createConnectedClient(wsUrl, makeToken(recipientId));
    await recipient.openPromise;
    const invite = await recipient.waitFor(
      (message) => message.type === "call:invite" && message.callId === callId,
    );
    assert.equal(invite.payload.fromUser.id, callerId);
    assert.equal(invite.payload.fromUser.displayName, "Caller");

    const accepted = caller.waitFor(
      (message) => message.type === "call:accept" && message.callId === callId,
    );
    recipient.ws.send(JSON.stringify({ type: "call:accept", callId, payload: { callId } }));
    await accepted;
    caller.ws.close();
    recipient.ws.close();
  }, database, async (userId, payload) => {
    sentPushes.push({ userId, payload });
  });
});
