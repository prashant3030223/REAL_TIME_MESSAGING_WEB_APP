import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import type { Pool } from "pg";
import type { AppLogger } from "./logger.js";
import type { ScheduledMessagePayload } from "./scheduledMessages.js";
import { PredictiveCallRecoveryEstimator } from "../../../src/call-recovery/risk-estimator.mjs";
import { resolveSessionUserId, SESSION_COOKIE_NAME } from "./auth.js";
import { areUsersConnected } from "./connections.js";
import {
  createR2AttachmentStorage,
  deleteR2Attachments,
} from "./objectStorage.js";
import type { R2AttachmentStorage } from "./objectStorage.js";
import type { PushNotificationPayload } from "./push.js";

export type RealtimeClient = {
  id: string;
  ws: WebSocket;
  isAlive: boolean;
  userId?: string;
  username?: string;
  displayName?: string;
  avatar?: string;
  phone?: string;
  currentRoom?: string;
};

export type RealtimeMessage = {
  type: string;
  payload?: any;
  senderId?: string;
  targetId?: string;
  conversationId?: string;
  callId?: string;
  timestamp?: number;
};

export function createRealtimeGateway(
  server: HttpServer,
  logger: AppLogger,
  database?: Pool,
  providedAttachmentStorage?: R2AttachmentStorage,
  notifyPushToUser?: (userId: string, payload: PushNotificationPayload) => Promise<void>,
) {
  const attachmentStorage = providedAttachmentStorage ?? createR2AttachmentStorage();
  const sessionByRequest = new WeakMap<object, Promise<string | null>>();
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    ...(database ? {
      verifyClient: (info, done) => {
        const cookieHeader = info.req.headers.cookie ?? "";
        const token = cookieHeader
          .split(";")
          .map((cookie) => cookie.trim())
          .find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`))
          ?.slice(SESSION_COOKIE_NAME.length + 1);
        const session = resolveSessionUserId(database, token);
        sessionByRequest.set(info.req, session);
        void session.then(
          (userId) => done(Boolean(userId), userId ? 200 : 401, userId ? "OK" : "Unauthorized"),
          (error: unknown) => {
            logger.error({
              errorName: error instanceof Error ? error.name : "UnknownError",
            }, "WebSocket session verification failed");
            done(false, 503, "Session verification unavailable");
          },
        );
      },
    } : {}),
  });
  const clients = new Map<string, RealtimeClient>();
  const callParticipants = new Map<string, Set<string>>();
  const pendingCallParticipants = new Map<string, Set<string>>();
  const activeCallIds = new Set<string>();
  const callVideoModes = new Map<string, boolean>();
  const pendingCallInvites = new Map<string, {
    recipientUserId: string;
    callerUserId: string;
    serializedMessage: string;
    timeout: NodeJS.Timeout;
  }>();
  const maxCallParticipants = 10;
  const pcrEstimator = new PredictiveCallRecoveryEstimator({ windowMs: 12_000, maxSamples: 20 });

  function broadcast(message: RealtimeMessage, excludeClientId?: string) {
    const raw = JSON.stringify(message);
    for (const [clientId, client] of clients.entries()) {
      if (clientId !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(raw);
        } catch (err) {
          logger.warn({ clientId, error: err instanceof Error ? err.message : "Send failed" }, "WebSocket broadcast failed");
        }
      }
    }
  }

  function sendToCallParticipants(callId: string, type: string, payload: Record<string, unknown>, excludeClientId?: string) {
    const participants = callParticipants.get(callId);
    if (!participants) return;
    const raw = JSON.stringify({ type, callId, payload: { ...payload, callId } });
    for (const [participantClientId, participantClient] of clients) {
      if (
        participantClientId !== excludeClientId &&
        participantClient.userId &&
        participants.has(participantClient.userId) &&
        participantClient.ws.readyState === WebSocket.OPEN
      ) {
        participantClient.ws.send(raw);
      }
    }
  }

  function sendParticipantSnapshot(callId: string) {
    const participantIds = callParticipants.get(callId);
    if (!participantIds) return;
    const participants = [...participantIds].map((id) => {
      const participant = [...clients.values()].find((connected) => connected.userId === id);
      return participant
        ? {
            id,
            displayName: participant.displayName || participant.username || "Participant",
            avatar: participant.avatar || "/avatars/boy.png",
          }
        : null;
    }).filter((participant) => participant !== null);
    sendToCallParticipants(callId, "call:participants", { participants });
  }

  function clearCall(callId: string) {
    const pendingInvite = pendingCallInvites.get(callId);
    if (pendingInvite) clearTimeout(pendingInvite.timeout);
    pendingCallInvites.delete(callId);
    callParticipants.delete(callId);
    pendingCallParticipants.delete(callId);
    activeCallIds.delete(callId);
    callVideoModes.delete(callId);
  }

  function dismissCallPush(userId: string, callId: string) {
    if (!notifyPushToUser) return;
    void notifyPushToUser(userId, {
      type: "call-ended",
      title: "ConnectSphere",
      body: "",
      callId,
      tag: `call-${callId}`,
    }).catch((error: unknown) => {
      logger.warn({
        callId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "Could not dismiss an incoming call notification");
    });
  }

  function trackPendingCallInvite(
    callId: string,
    callerUserId: string,
    recipientUserId: string,
    serializedMessage: string,
  ) {
    let pendingInvite: {
      recipientUserId: string;
      callerUserId: string;
      serializedMessage: string;
      timeout: NodeJS.Timeout;
    } | undefined;
    const timeout = setTimeout(() => {
      if (!pendingInvite || pendingCallInvites.get(callId) !== pendingInvite) return;
      const ended = JSON.stringify({
        type: "call:hangup",
        callId,
        payload: { callId },
      });
      for (const connectedClient of clients.values()) {
        if (
          connectedClient.userId === recipientUserId &&
          connectedClient.ws.readyState === WebSocket.OPEN
        ) {
          connectedClient.ws.send(ended);
        }
      }
      dismissCallPush(recipientUserId, callId);
      clearCall(callId);
      const unavailable = JSON.stringify({
        type: "call:unavailable",
        callId,
        payload: {
          callId,
          reason: "No answer. The call has ended.",
        },
      });
      for (const connectedClient of clients.values()) {
        if (
          connectedClient.userId === callerUserId &&
          connectedClient.ws.readyState === WebSocket.OPEN
        ) {
          connectedClient.ws.send(unavailable);
        }
      }
    }, 45_000);
    timeout.unref();
    pendingInvite = {
      recipientUserId,
      callerUserId,
      serializedMessage,
      timeout,
    };
    pendingCallInvites.set(callId, pendingInvite);
  }

  function broadcastPresence() {
    const onlineUsersById = new Map<string, {
      userId: string;
      phone?: string | undefined;
      username?: string | undefined;
      displayName?: string | undefined;
      avatar?: string | undefined;
    }>();
    for (const client of clients.values()) {
      if (!client.userId || client.ws.readyState !== WebSocket.OPEN) continue;
      onlineUsersById.set(client.userId, {
        userId: client.userId,
        phone: client.phone,
        username: client.username,
        displayName: client.displayName,
        avatar: client.avatar,
      });
    }
    const onlineUsers = Array.from(onlineUsersById.values());

    broadcast({
      type: "presence:update",
      payload: { onlineUsers, count: onlineUsers.length },
      timestamp: Date.now(),
    });
  }

  function markUserOfflineIfDisconnected(userId: string | undefined) {
    if (!database || !userId ||
      [...clients.values()].some((client) => client.userId === userId && client.ws.readyState === WebSocket.OPEN)) {
      return;
    }
    void database.query("UPDATE app_users SET last_seen_at = now() WHERE id = $1", [userId]).catch((error: unknown) => {
      logger.error({
        userId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "Could not update user last-seen time");
    });
  }

  async function broadcastToConversation(
    message: RealtimeMessage,
    conversationId: string,
    senderId: string,
    senderClientId: string,
  ): Promise<{ isMember: boolean; recipientDeliveredCount: number; hasBotMember: boolean }> {
    if (!database) {
      broadcast(message, senderClientId);
      return { isMember: true, recipientDeliveredCount: clients.size > 1 ? 1 : 0, hasBotMember: false };
    }

    const membership = await database.query<{ user_id: string; type: string }>(
      `SELECT member.user_id, conversation.type
       FROM app_conversation_members member
       JOIN app_conversations conversation ON conversation.id = member.conversation_id
       WHERE member.conversation_id = $1`,
      [conversationId],
    );
    if (!membership.rows.some((member) => member.user_id === senderId)) {
      return { isMember: false, recipientDeliveredCount: 0, hasBotMember: false };
    }
    if (membership.rows[0]?.type === "direct") {
      const peerId = membership.rows.find((member) => member.user_id !== senderId)?.user_id;
      if (!peerId || !(await areUsersConnected(database, senderId, peerId))) {
        return { isMember: false, recipientDeliveredCount: 0, hasBotMember: false };
      }
    }
    const memberIds = new Set(membership.rows.map((member) => member.user_id));

    const raw = JSON.stringify(message);
    let recipientDeliveredCount = 0;
    for (const [clientId, client] of clients.entries()) {
      if (
        clientId !== senderClientId &&
        client.userId &&
        memberIds.has(client.userId) &&
        client.ws.readyState === WebSocket.OPEN
      ) {
        recipientDeliveredCount++;
        client.ws.send(raw);
      }
    }
    return { isMember: true, recipientDeliveredCount, hasBotMember: false };
  }

  async function broadcastReadReceipt(
    conversationId: string,
    readerId: string,
    messageIds: string[],
  ): Promise<void> {
    await broadcastToConversation(
      {
        type: "chat:read",
        conversationId,
        payload: { conversationId, messageIds, status: "read" },
      },
      conversationId,
      readerId,
      "",
    );
  }

  async function broadcastScheduledMessage(message: ScheduledMessagePayload) {
    const realtimeMessage: RealtimeMessage = {
      type: "chat:message",
      conversationId: message.conversationId,
      payload: message,
    };
    if (database) {
      await broadcastToConversation(
        realtimeMessage,
        message.conversationId,
        message.senderId,
        "",
      );
      if (notifyPushToUser) {
        const recipients = await database.query<{ user_id: string; conversation_name: string }>(
          `SELECT member.user_id, conversation.name AS conversation_name
           FROM app_conversation_members member
           JOIN app_conversations conversation ON conversation.id = member.conversation_id
           WHERE member.conversation_id = $1 AND member.user_id <> $2`,
          [message.conversationId, message.senderId],
        );
        for (const recipient of recipients.rows) {
          void notifyPushToUser(recipient.user_id, {
            type: "message",
            title: recipient.conversation_name || message.senderName || "New message",
            body: message.text.slice(0, 240),
            url: `/?conversation=${encodeURIComponent(message.conversationId)}`,
            conversationId: message.conversationId,
            tag: `msg-${message.conversationId}`,
          }).catch((error: unknown) => {
            logger.warn({
              userId: recipient.user_id,
              errorName: error instanceof Error ? error.name : "UnknownError",
            }, "Could not enqueue a scheduled-message push notification");
          });
        }
      }
    } else {
      broadcast(realtimeMessage);
    }
  }

  async function broadcastMessageDeleted(payload: {
    messageId: string;
    conversationId: string;
    deletedBy: string;
    ghostUnsend?: boolean;
  }) {
    await broadcastToConversation(
      {
        type: "chat:delete",
        conversationId: payload.conversationId,
        payload: { ...payload, deletedForEveryone: true },
      },
      payload.conversationId,
      payload.deletedBy,
      "",
    );
  }

  wss.on("connection", (ws, req) => {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const client: RealtimeClient = {
      id: clientId,
      ws,
      isAlive: true,
    };
    clients.set(clientId, client);

    logger.info({ clientId, ip: req.socket.remoteAddress }, "WebSocket client connected");
    const session = sessionByRequest.get(req);
    if (session) {
      void session.then(async (userId) => {
        if (!userId) return;
        client.userId = userId;
        const profile = await database!.query<{
          username: string | null;
          display_name: string;
          avatar: string | null;
          phone: string | null;
        }>(
          "SELECT username, display_name, avatar, phone FROM app_users WHERE id = $1",
          [userId],
        );
        const user = profile.rows[0];
        if (user) {
          if (user.username !== null) client.username = user.username;
          client.displayName = user.display_name;
          if (user.avatar !== null) client.avatar = user.avatar;
          if (user.phone !== null) client.phone = user.phone;
        }
        for (const invite of pendingCallInvites.values()) {
          if (invite.recipientUserId === userId && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(invite.serializedMessage);
          }
        }
        broadcastPresence();
      }).catch((error: unknown) => {
        logger.error({
          clientId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        }, "WebSocket user profile lookup failed");
        ws.close(1011, "Session lookup failed");
      });
    }

    ws.on("pong", () => {
      client.isAlive = true;
    });

    // Send welcome acknowledgment
    ws.send(JSON.stringify({
      type: "connection:ack",
      payload: { clientId, serverTime: Date.now() },
    }));

    ws.on("message", async (data) => {
      try {
        if (session) await session;
        if (database && !client.userId) {
          ws.close(1008, "Authentication required");
          return;
        }
        const msg = JSON.parse(data.toString()) as RealtimeMessage;
        msg.senderId = client.userId ?? clientId;
        msg.timestamp = Date.now();

        switch (msg.type) {
          case "identify": {
            if (!database) {
              client.userId = msg.payload?.userId;
              client.username = msg.payload?.username;
              client.displayName = msg.payload?.displayName;
              client.avatar = msg.payload?.avatar;
              client.phone = msg.payload?.phone;
            }
            logger.info({ clientId, userId: client.userId, phone: client.phone }, "Client identified");
            broadcastPresence();
            break;
          }

          case "chat:typing": {
            if (database && msg.conversationId && client.userId) {
              msg.payload = {
                ...msg.payload,
                user: {
                  id: client.userId,
                  username: client.username,
                  displayName: client.displayName,
                  avatar: client.avatar,
                },
              };
              await broadcastToConversation(msg, msg.conversationId, client.userId, clientId);
            } else if (!database) {
              broadcast(msg, clientId);
            }
            break;
          }

          case "chat:disappearing": {
            if (!msg.conversationId || !client.userId) break;
            const hours = msg.payload?.hours;
            if (!Number.isInteger(hours) || hours < 0 || hours > 720) break;
            if (database) {
              const setting = await database.query<{ disappearing_timer_hours: number }>(
                `SELECT conversation.disappearing_timer_hours
                 FROM app_conversations conversation
                 JOIN app_conversation_members member
                   ON member.conversation_id = conversation.id
                 WHERE conversation.id = $1 AND member.user_id = $2`,
                [msg.conversationId, client.userId],
              );
              const timerHours = setting.rows[0]?.disappearing_timer_hours;
              if (timerHours === undefined) break;
              msg.payload = { conversationId: msg.conversationId, hours: timerHours };
              await broadcastToConversation(msg, msg.conversationId, client.userId, clientId);
            } else {
              broadcast(msg, clientId);
            }
            break;
          }

          case "chat:message": {
            if (database) {
              const conversationId = msg.conversationId;
              const messageId = msg.payload?.id;
              if (!conversationId || !client.userId || typeof messageId !== "string" || !/^[0-9a-f-]{36}$/i.test(messageId)) break;
              msg.payload = { ...msg.payload, senderId: client.userId };
              const { isMember, recipientDeliveredCount, hasBotMember } = await broadcastToConversation(
                msg,
                conversationId,
                client.userId,
                clientId,
              );
              if (!isMember) {
                ws.send(JSON.stringify({
                  type: "chat:error",
                  payload: { conversationId, messageId: msg.payload?.id, code: "CONVERSATION_NOT_FOUND" },
                }));
                break;
              }
              const recipientOnline = recipientDeliveredCount > 0 || hasBotMember;
              ws.send(JSON.stringify({
                type: recipientOnline ? "chat:delivered" : "chat:sent",
                payload: {
                  messageId: msg.payload?.id,
                  conversationId,
                  status: recipientOnline ? "delivered" : "sent",
                },
              }));

              if (hasBotMember && msg.payload?.id) {
                setTimeout(async () => {
                  try {
                    if (database) {
                      await database.query(
                        "UPDATE app_messages SET status = 'read' WHERE id = $1 AND conversation_id = $2",
                        [msg.payload.id, conversationId],
                      );
                    }
                    ws.send(JSON.stringify({
                      type: "chat:read",
                      payload: {
                        conversationId,
                        messageIds: [msg.payload.id],
                        status: "read",
                      },
                    }));
                  } catch {}
                }, 250);
              }
              break;
            }

            const targetUserId = msg.payload?.targetUserId;
            const targetPhone = msg.payload?.targetPhone ? String(msg.payload.targetPhone).replace(/\D/g, "").slice(-10) : "";

            let recipientOnline = false;
            for (const [otherId, otherClient] of clients.entries()) {
              if (otherId === clientId) continue;
              const otherPhoneDigits = (otherClient.phone || "").replace(/\D/g, "").slice(-10);
              const matchUser = targetUserId && otherClient.userId === targetUserId;
              const matchPhone = targetPhone && otherPhoneDigits && otherPhoneDigits === targetPhone;

              if (matchUser || matchPhone) {
                recipientOnline = true;
                if (otherClient.ws.readyState === WebSocket.OPEN) {
                  try {
                    otherClient.ws.send(JSON.stringify(msg));
                  } catch {}
                }
              }
            }

            // If it's a broadcast or group room
            if (!targetUserId && !targetPhone) {
              broadcast(msg, clientId);
              recipientOnline = clients.size > 1;
            }

            // Report real delivery status back to sender
            if (recipientOnline) {
              ws.send(JSON.stringify({
                type: "chat:delivered",
                payload: {
                  messageId: msg.payload?.id,
                  conversationId: msg.conversationId,
                  status: "delivered",
                },
              }));
            } else {
              ws.send(JSON.stringify({
                type: "chat:sent",
                payload: {
                  messageId: msg.payload?.id,
                  conversationId: msg.conversationId,
                  status: "sent",
                },
              }));
            }
            break;
          }

          case "chat:read": {
            if (!database) {
              broadcast(msg, clientId);
              break;
            }
            if (!msg.conversationId || !client.userId || !Array.isArray(msg.payload?.messageIds)) break;
            const messageIds = Array.from(new Set(
              msg.payload.messageIds.filter((id: unknown): id is string =>
                typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)
              )
            )).slice(0, 100);
            if (messageIds.length === 0) break;
            const updated = await database.query<{ id: string }>(
              `UPDATE app_messages m
               SET status = 'read'
               WHERE m.id = ANY($1::uuid[]) AND m.conversation_id = $2
                 AND m.sender_id <> $3 AND m.status <> 'read'
                 AND EXISTS (
                   SELECT 1 FROM app_conversation_members member
                   WHERE member.conversation_id = m.conversation_id AND member.user_id = $3
                 )
               RETURNING m.id`,
              [messageIds, msg.conversationId, client.userId],
            );
            if (updated.rows.length > 0) {
              msg.payload = {
                messageIds: updated.rows.map((row) => row.id),
                conversationId: msg.conversationId,
                status: "read",
              };
              await broadcastToConversation(msg, msg.conversationId, client.userId, clientId);
            }
            break;
          }

          case "chat:reaction": {
            if (!msg.conversationId || !client.userId) break;
            const messageId = msg.payload?.messageId;
            const emoji = msg.payload?.emoji;
            if (
              typeof messageId !== "string" ||
              !/^[0-9a-f-]{36}$/i.test(messageId) ||
              typeof emoji !== "string" ||
              emoji.length === 0 ||
              Array.from(emoji).length > 16
            ) break;

            const isReacting = msg.payload?.isReacting !== false;
            if (database) {
              const updated = await database.query(
                `UPDATE app_messages AS m
                 SET metadata = jsonb_set(
                   COALESCE(m.metadata, '{}'::jsonb),
                   '{reactions}',
                   (
                     SELECT CASE WHEN $5::boolean THEN
                       jsonb_set(
                         COALESCE(cleaned.reactions, '{}'::jsonb),
                         ARRAY[$4]::text[],
                         COALESCE(cleaned.reactions -> $4, '[]'::jsonb) || jsonb_build_array($3::text),
                         true
                       )
                     ELSE COALESCE(cleaned.reactions, '{}'::jsonb)
                     END
                     FROM (
                       SELECT jsonb_object_agg(reaction.emoji, to_jsonb(reaction.users)) AS reactions
                       FROM (
                         SELECT entry.key AS emoji,
                                array_agg(reaction_user.user_id)
                                  FILTER (WHERE entry.key <> $4 OR reaction_user.user_id <> $3) AS users
                         FROM jsonb_each(
                           CASE
                             WHEN jsonb_typeof(m.metadata->'reactions') = 'object'
                             THEN m.metadata->'reactions'
                             ELSE '{}'::jsonb
                           END
                         ) AS entry(key, value)
                         CROSS JOIN LATERAL jsonb_array_elements_text(
                           CASE
                             WHEN jsonb_typeof(entry.value) = 'array'
                             THEN entry.value
                             ELSE '[]'::jsonb
                           END
                         ) AS reaction_user(user_id)
                         GROUP BY entry.key
                       ) AS reaction
                       WHERE cardinality(reaction.users) > 0
                     ) AS cleaned
                   ),
                   true
                 )
                 WHERE m.id = $1 AND m.conversation_id = $2
                   AND EXISTS (
                     SELECT 1
                     FROM app_conversation_members member
                     JOIN app_conversations conversation ON conversation.id = member.conversation_id
                     WHERE member.conversation_id = m.conversation_id AND member.user_id = $3
                       AND (
                         conversation.type <> 'direct'
                         OR EXISTS (
                           SELECT 1
                           FROM app_conversation_members peer
                           JOIN app_user_connections connection
                             ON connection.user_low = LEAST(member.user_id, peer.user_id)
                            AND connection.user_high = GREATEST(member.user_id, peer.user_id)
                           WHERE peer.conversation_id = member.conversation_id
                             AND peer.user_id <> member.user_id
                             AND NOT EXISTS (
                               SELECT 1 FROM app_user_blocks block
                               WHERE (block.blocker_id = member.user_id AND block.blocked_id = peer.user_id)
                                  OR (block.blocker_id = peer.user_id AND block.blocked_id = member.user_id)
                             )
                         )
                       )
                   )
                 RETURNING m.id`,
                [messageId, msg.conversationId, client.userId, emoji, isReacting],
              );
              if (updated.rowCount === 0) break;
            }

            msg.payload = {
              ...msg.payload,
              userId: client.userId,
              isReacting,
            };
            if (database) {
              await broadcastToConversation(msg, msg.conversationId, client.userId, clientId);
            } else {
              broadcast(msg, clientId);
            }
            break;
          }

          case "chat:pin": {
            if (!msg.conversationId || !client.userId) break;
            const messageId = msg.payload?.messageId;
            const isPinned = msg.payload?.isPinned;
            if (
              typeof messageId !== "string" ||
              !/^[0-9a-f-]{36}$/i.test(messageId) ||
              typeof isPinned !== "boolean"
            ) break;

            if (database) {
              const savedPin = await database.query<{ is_pinned: string | null }>(
                `SELECT metadata->>'isPinned' AS is_pinned
                 FROM app_messages
                 WHERE id = $1 AND conversation_id = $2`,
                [messageId, msg.conversationId],
              );
              if (savedPin.rows[0]?.is_pinned !== String(isPinned)) break;
            }

            msg.payload = { messageId, conversationId: msg.conversationId, isPinned };
            const { isMember } = await broadcastToConversation(
              msg,
              msg.conversationId,
              client.userId,
              clientId,
            );
            if (!isMember) {
              ws.send(JSON.stringify({
                type: "chat:error",
                payload: { conversationId: msg.conversationId, messageId, code: "CONVERSATION_NOT_FOUND" },
              }));
            }
            break;
          }

          case "chat:status":
          case "chat:delete":
          case "chat:clear": {
            if (database && msg.conversationId && client.userId) {
              if (msg.type === "chat:status") {
                const status = msg.payload?.status;
                if (status !== "delivered" && status !== "read") break;
                const updated = await database.query(
                  `UPDATE app_messages m
                   SET status = CASE WHEN $1 = 'read' THEN 'read' ELSE 'delivered' END
                   WHERE m.id = $2 AND m.conversation_id = $3 AND m.sender_id <> $4 AND m.status <> 'read'
                     AND EXISTS (
                       SELECT 1 FROM app_conversation_members member
                       WHERE member.conversation_id = m.conversation_id AND member.user_id = $4
                     )`,
                  [status, msg.payload?.messageId, msg.conversationId, client.userId],
                );
                if (updated.rowCount === 0) break;
              } else if (msg.type === "chat:delete") {
                const messageId = msg.payload?.messageId;
                if (typeof messageId !== "string" || !/^[0-9a-f-]{36}$/i.test(messageId)) break;
                const existing = await database.query<{ sender_id: string; attachments: unknown[] | null }>(
                  `SELECT message.sender_id, message.attachments
                   FROM app_messages message
                   WHERE message.id = $1 AND message.conversation_id = $2 AND message.sender_id = $3
                     AND EXISTS (
                       SELECT 1 FROM app_conversation_members member
                       WHERE member.conversation_id = message.conversation_id AND member.user_id = $3
                     )`,
                  [messageId, msg.conversationId, client.userId],
                );
                const message = existing.rows[0];
                if (!message) break;
                try {
                  await deleteR2Attachments(attachmentStorage, msg.conversationId, message.attachments);
                } catch (error) {
                  logger.error({
                    messageId,
                    conversationId: msg.conversationId,
                    errorName: error instanceof Error ? error.name : "UnknownError",
                  }, "Failed to delete message attachments from Cloudflare R2");
                  ws.send(JSON.stringify({
                    type: "chat:error",
                    payload: {
                      conversationId: msg.conversationId,
                      messageId,
                      code: "ATTACHMENT_DELETE_FAILED",
                    },
                  }));
                  break;
                }
                if (msg.payload?.ghostUnsend) {
                  await database.query(
                    "DELETE FROM app_messages WHERE id = $1 AND conversation_id = $2 AND sender_id = $3",
                    [messageId, msg.conversationId, client.userId],
                  );
                } else {
                  await database.query(
                    `UPDATE app_messages
                     SET text = '🚫 This message was deleted',
                         metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{isDeleted}', 'true'),
                         attachments = NULL,
                         voice_note = NULL
                     WHERE id = $1 AND conversation_id = $2 AND sender_id = $3`,
                    [messageId, msg.conversationId, client.userId],
                  );
                }
              }
              await broadcastToConversation(msg, msg.conversationId, client.userId, clientId);
            } else if (!database) {
              broadcast(msg, clientId);
            }
            break;
          }

          case "chat:edit": {
            if (!msg.conversationId || !client.userId) break;
            const messageId = msg.payload?.messageId;
            if (typeof messageId !== "string" || !/^[0-9a-f-]{36}$/i.test(messageId)) break;

            if (database) {
              const editedMessage = await database.query<{ text: string }>(
                `SELECT message.text
                 FROM app_messages message
                 WHERE message.id = $1 AND message.conversation_id = $2
                   AND message.sender_id = $3
                   AND message.metadata->>'isEdited' = 'true'
                   AND COALESCE(message.metadata->>'isDeleted', 'false') <> 'true'`,
                [messageId, msg.conversationId, client.userId],
              );
              if (!editedMessage.rows[0]) break;
              msg.payload = {
                messageId,
                conversationId: msg.conversationId,
                text: editedMessage.rows[0].text,
                isEdited: true,
              };
              const { isMember } = await broadcastToConversation(
                msg,
                msg.conversationId,
                client.userId,
                clientId,
              );
              if (!isMember) {
                ws.send(JSON.stringify({
                  type: "chat:error",
                  payload: { conversationId: msg.conversationId, messageId, code: "CONVERSATION_NOT_FOUND" },
                }));
              }
            } else {
              broadcast(msg, clientId);
            }
            break;
          }

          case "chat:poll_vote": {
            if (!msg.conversationId || !client.userId) break;
            const messageId = msg.payload?.messageId;
            const optionId = msg.payload?.optionId;
            if (
              typeof messageId !== "string" ||
              !/^[0-9a-f-]{36}$/i.test(messageId) ||
              typeof optionId !== "string" ||
              optionId.length === 0
            ) break;

            if (database) {
              const savedMessage = await database.query<{ metadata: Record<string, unknown> }>(
                `SELECT message.metadata
                 FROM app_messages message
                 WHERE message.id = $1 AND message.conversation_id = $2
                   AND EXISTS (
                     SELECT 1 FROM app_conversation_members member
                     WHERE member.conversation_id = message.conversation_id AND member.user_id = $3
                   )`,
                [messageId, msg.conversationId, client.userId],
              );
              const poll = savedMessage.rows[0]?.metadata?.["poll"];
              if (!poll || typeof poll !== "object") break;
              msg.payload = { messageId, conversationId: msg.conversationId, poll };
              await broadcastToConversation(msg, msg.conversationId, client.userId, clientId);
            } else {
              const poll = msg.payload?.poll;
              if (!poll || typeof poll !== "object") break;
              msg.payload = { messageId, conversationId: msg.conversationId, poll };
              broadcast(msg, clientId);
            }
            break;
          }

          case "call:invite": {
            if (database && (!msg.callId || !client.userId)) break;
            let targetUserId =
              typeof msg.payload?.targetUserId === "string" &&
              /^[0-9a-f-]{36}$/i.test(msg.payload.targetUserId)
                ? msg.payload.targetUserId
                : undefined;
            const targetPhone = msg.payload?.targetPhone ? String(msg.payload.targetPhone).replace(/\D/g, "").slice(-10) : "";

            if (database && client.userId && !targetUserId && targetPhone.length === 10) {
              const recipient = await database.query<{ id: string }>(
                `SELECT id FROM app_users
                 WHERE right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10) = $1
                 LIMIT 1`,
                [targetPhone],
              );
              targetUserId = recipient.rows[0]?.id;
            }
            if (database && client.userId && (targetUserId || targetPhone) &&
              (!targetUserId || !(await areUsersConnected(database, client.userId, targetUserId)))) {
              ws.send(JSON.stringify({
                type: "call:unavailable",
                callId: msg.callId,
                payload: {
                  callId: msg.callId,
                  reason: "You can call this person after they accept your connection request.",
                },
              }));
              break;
            }

            let targetClient: RealtimeClient | undefined;
            for (const otherClient of clients.values()) {
              if (otherClient.userId === client.userId) continue;
              const otherPhoneDigits = (otherClient.phone || "").replace(/\D/g, "").slice(-10);
              const matchUser = targetUserId && otherClient.userId === targetUserId;
              const matchPhone = targetPhone && otherPhoneDigits && otherPhoneDigits === targetPhone;
              if (matchUser || matchPhone) {
                targetClient = otherClient;
                break;
              }
            }

            if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
              if (database && client.userId) {
                msg.payload = {
                  ...msg.payload,
                  fromUser: {
                    id: client.userId,
                    username: client.username,
                    displayName: client.displayName,
                    avatar: client.avatar,
                    phone: client.phone,
                  },
                };
              }
              if (client.userId && targetClient.userId && msg.callId) {
                callParticipants.set(msg.callId, new Set([client.userId, targetClient.userId]));
                pendingCallParticipants.delete(msg.callId);
                activeCallIds.delete(msg.callId);
                callVideoModes.set(msg.callId, msg.payload?.isVideo !== false);
                trackPendingCallInvite(
                  msg.callId,
                  client.userId,
                  targetClient.userId,
                  JSON.stringify(msg),
                );
              }
              // Recipient is online: forward invite and inform caller that recipient is ringing
              targetClient.ws.send(JSON.stringify(msg));
              if (notifyPushToUser && targetClient.userId) {
                const callerName = client.displayName || client.username || "ConnectSphere user";
                void notifyPushToUser(targetClient.userId, {
                  type: "call",
                  title: msg.payload?.isVideo === false ? "Incoming voice call" : "Incoming video call",
                  body: `${callerName} is calling you`,
                  url: "/",
                  ...(msg.callId ? { callId: msg.callId } : {}),
                  isVideo: msg.payload?.isVideo !== false,
                  tag: `call-${msg.callId}`,
                }).catch((error: unknown) => {
                  logger.warn({
                    callId: msg.callId,
                    errorName: error instanceof Error ? error.name : "UnknownError",
                  }, "Could not send an incoming call push notification");
                });
              }
              ws.send(JSON.stringify({
                type: "call:ringing",
                callId: msg.callId,
              }));
            } else if (database && msg.callId && client.userId && (targetUserId || targetPhone)) {
              let recipientUserId = targetUserId;
              if (!recipientUserId && targetPhone.length === 10) {
                const recipient = await database.query<{ id: string }>(
                  `SELECT id FROM app_users
                   WHERE right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10) = $1
                   LIMIT 1`,
                  [targetPhone],
                );
                recipientUserId = recipient.rows[0]?.id;
              }

              const recipient = recipientUserId && /^[0-9a-f-]{36}$/i.test(recipientUserId)
                ? await database.query<{ id: string }>(
                    "SELECT id FROM app_users WHERE id = $1",
                    [recipientUserId],
                  )
                : { rows: [] as Array<{ id: string }> };
              if (recipientUserId && recipient.rows[0] && recipientUserId !== client.userId) {
                const callerName = client.displayName || client.username || "ConnectSphere user";
                const callPayload = {
                  ...msg.payload,
                  callId: msg.callId,
                  fromUser: {
                    id: client.userId,
                    username: client.username,
                    displayName: callerName,
                    avatar: client.avatar,
                    phone: client.phone,
                  },
                };
                msg.payload = callPayload;
                const callId = msg.callId;
                const serializedMessage = JSON.stringify(msg);
                callParticipants.set(callId, new Set([client.userId, recipientUserId]));
                pendingCallParticipants.delete(callId);
                activeCallIds.delete(callId);
                callVideoModes.set(callId, msg.payload?.isVideo !== false);

                trackPendingCallInvite(
                  callId,
                  client.userId,
                  recipientUserId,
                  serializedMessage,
                );

                ws.send(JSON.stringify({
                  type: "call:ringing",
                  callId,
                }));
                if (notifyPushToUser) {
                  const notification: PushNotificationPayload = {
                    type: "call",
                    title: msg.payload?.isVideo === false ? "Incoming voice call" : "Incoming video call",
                    body: `${callerName} is calling you`,
                    url: "/",
                    callId,
                    isVideo: msg.payload?.isVideo !== false,
                    tag: `call-${callId}`,
                  };
                  void notifyPushToUser(recipientUserId, notification).catch((error: unknown) => {
                    logger.warn({
                      callId,
                      errorName: error instanceof Error ? error.name : "UnknownError",
                    }, "Could not send an incoming call push notification");
                  });
                }
              } else {
                ws.send(JSON.stringify({
                  type: "call:unavailable",
                  callId: msg.callId,
                  reason: "This user is currently unavailable.",
                }));
              }
            } else if (!targetUserId && !targetPhone && clients.size > 1) {
              // Group / broadcast call
              if (client.userId && msg.callId) {
                const pending = new Set<string>();
                for (const callClient of clients.values()) {
                  if (!callClient.userId || callClient.userId === client.userId) continue;
                  if (!database || (await areUsersConnected(database, client.userId, callClient.userId))) {
                    pending.add(callClient.userId);
                  }
                }
                if (pending.size === 0) {
                  ws.send(JSON.stringify({
                    type: "call:unavailable",
                    callId: msg.callId,
                    payload: {
                      callId: msg.callId,
                      reason: "Connect with someone before starting a group call.",
                    },
                  }));
                  break;
                }
                if (pending.size + 1 > maxCallParticipants) {
                  ws.send(JSON.stringify({
                    type: "call:unavailable",
                    callId: msg.callId,
                    reason: `Group calls are limited to ${maxCallParticipants} participants.`,
                  }));
                  break;
                }
                callParticipants.set(msg.callId, new Set([client.userId]));
                pendingCallParticipants.set(msg.callId, pending);
                activeCallIds.delete(msg.callId);
                callVideoModes.set(msg.callId, msg.payload?.isVideo !== false);
                if (database) {
                  msg.payload = {
                    ...msg.payload,
                    fromUser: {
                      id: client.userId,
                      username: client.username,
                      displayName: client.displayName,
                      avatar: client.avatar,
                      phone: client.phone,
                    },
                  };
                }
                const raw = JSON.stringify(msg);
                for (const callClient of clients.values()) {
                  if (callClient.userId && pending.has(callClient.userId) &&
                    callClient.ws.readyState === WebSocket.OPEN) {
                    callClient.ws.send(raw);
                  }
                }
              } else {
                broadcast(msg, clientId);
              }
            } else {
              // Recipient is OFFLINE
              ws.send(JSON.stringify({
                type: "call:unavailable",
                callId: msg.callId,
                reason: "User is currently offline.",
              }));
            }
            break;
          }

          case "call:add-participant": {
            const callId = msg.callId;
            const participants = callId ? callParticipants.get(callId) : undefined;
            const targetUserId = msg.payload?.targetUserId;
            const targetPhone = msg.payload?.targetPhone
              ? String(msg.payload.targetPhone).replace(/\D/g, "").slice(-10)
              : "";
            const fail = (reason: string) => {
              ws.send(JSON.stringify({
                type: "call:add-participant:error",
                callId,
                payload: {
                  callId,
                  reason,
                  ...(typeof targetUserId === "string" ? { targetUserId } : {}),
                },
              }));
            };
            if (
              !callId ||
              !client.userId ||
              !activeCallIds.has(callId) ||
              !participants?.has(client.userId)
            ) {
              fail("You can only invite people to a call you have joined.");
              break;
            }
            if (!targetUserId && !targetPhone) {
              fail("Choose a contact to invite.");
              break;
            }

            let targetClient: RealtimeClient | undefined;
            for (const otherClient of clients.values()) {
              if (otherClient.userId === client.userId) continue;
              const phoneDigits = (otherClient.phone || "").replace(/\D/g, "").slice(-10);
              if (
                (targetUserId && otherClient.userId === targetUserId) ||
                (targetPhone && phoneDigits && phoneDigits === targetPhone)
              ) {
                targetClient = otherClient;
                break;
              }
            }
            if (!targetClient?.userId) {
              fail("This contact is offline and cannot join right now.");
              break;
            }
            if (database && !(await areUsersConnected(database, client.userId, targetClient.userId))) {
              fail("You can invite this person after they accept your connection request.");
              break;
            }
            if (participants.has(targetClient.userId)) {
              fail("This person is already in the call.");
              break;
            }
            const pending = pendingCallParticipants.get(callId) ?? new Set<string>();
            if (pending.has(targetClient.userId)) {
              fail("This person has already been invited.");
              break;
            }
            if (participants.size + pending.size >= maxCallParticipants) {
              fail("This call has reached its 10-person limit.");
              break;
            }

            pending.add(targetClient.userId);
            pendingCallParticipants.set(callId, pending);
            targetClient.ws.send(JSON.stringify({
              type: "call:invite",
              callId,
              payload: {
                callId,
                peerName: client.displayName || client.username || "Call participant",
                peerAvatar: client.avatar || "/avatars/boy.png",
                isVideo: callVideoModes.get(callId) ?? true,
                groupInvite: true,
                fromUser: {
                  id: client.userId,
                  username: client.username,
                  displayName: client.displayName,
                  avatar: client.avatar,
                  phone: client.phone,
                },
              },
            }));
            sendToCallParticipants(callId, "call:participant-invited", {
              participant: {
                id: targetClient.userId,
                displayName: targetClient.displayName || targetClient.username || "Participant",
                avatar: targetClient.avatar || "/avatars/boy.png",
              },
            });
            break;
          }

          case "call:chat": {
            const callId = msg.callId;
            const messageId = msg.payload?.id;
            const text = msg.payload?.text;
            const participants = callId ? callParticipants.get(callId) : undefined;
            if (
              !callId ||
              !client.userId ||
              !participants?.has(client.userId) ||
              !activeCallIds.has(callId) ||
              typeof messageId !== "string" ||
              !/^[0-9a-f-]{36}$/i.test(messageId) ||
              typeof text !== "string" ||
              text.trim().length === 0 ||
              text.length > 1000
            ) {
              break;
            }

            msg.payload = {
              callId,
              id: messageId,
              text,
              senderId: client.userId,
              senderName: client.displayName || client.username || "Participant",
              sentAt: Date.now(),
            };
            const raw = JSON.stringify(msg);
            for (const otherClient of clients.values()) {
              if (
                otherClient.id !== clientId &&
                otherClient.userId &&
                participants.has(otherClient.userId) &&
                otherClient.ws.readyState === WebSocket.OPEN
              ) {
                otherClient.ws.send(raw);
              }
            }
            break;
          }

          case "call:ready":
          case "call:accept": {
            logger.info({ type: msg.type, callId: msg.callId }, "WebRTC signaling event relayed");
            const callId = msg.callId;
            const participants = callId ? callParticipants.get(callId) : undefined;
            const pending = callId ? pendingCallParticipants.get(callId) : undefined;
            const isPendingParticipant = Boolean(
              msg.type === "call:accept" && client.userId && pending?.has(client.userId),
            );
            if (!callId) break;
            if (!client.userId || !participants) {
              if (database) break;
              broadcast(msg, clientId);
              if (msg.type === "call:accept") activeCallIds.add(callId);
              break;
            }
            if (!participants.has(client.userId) && !isPendingParticipant) break;
            if (msg.type === "call:ready" && !activeCallIds.has(callId)) break;

            if (isPendingParticipant) {
              if (participants.size >= maxCallParticipants) {
                pending?.delete(client.userId);
                ws.send(JSON.stringify({
                  type: "call:add-participant:error",
                  callId,
                  payload: { callId, reason: "This call has reached its 10-person limit." },
                }));
                break;
              }
              participants.add(client.userId);
              pending?.delete(client.userId);
              if (pending?.size === 0) pendingCallParticipants.delete(callId);
            }

            if (msg.type === "call:accept") {
              const pendingInvite = pendingCallInvites.get(callId);
              if (pendingInvite?.recipientUserId === client.userId) {
                clearTimeout(pendingInvite.timeout);
                pendingCallInvites.delete(callId);
                dismissCallPush(client.userId, callId);
              }
              activeCallIds.add(callId);
            }
            msg.payload = { ...msg.payload, fromUserId: client.userId };
            const raw = JSON.stringify(msg);
            for (const [otherClientId, otherClient] of clients) {
              if (
                otherClientId !== clientId &&
                otherClient.userId &&
                participants.has(otherClient.userId) &&
                otherClient.ws.readyState === WebSocket.OPEN
              ) {
                otherClient.ws.send(raw);
              }
            }
            if (msg.type === "call:accept") sendParticipantSnapshot(callId);
            break;
          }

          case "call:decline":
          case "call:hangup": {
            const callId = msg.callId;
            const participants = callId ? callParticipants.get(callId) : undefined;
            const pending = callId ? pendingCallParticipants.get(callId) : undefined;
            if (!callId || !client.userId || !participants) {
              if (!database && callId) broadcast(msg, clientId);
              break;
            }
            const pendingInvite = pendingCallInvites.get(callId);
            if (
              pendingInvite &&
              ((msg.type === "call:hangup" && pendingInvite.callerUserId === client.userId) ||
                (msg.type === "call:decline" && pendingInvite.recipientUserId === client.userId))
            ) {
              dismissCallPush(pendingInvite.recipientUserId, callId);
            }

            if (msg.type === "call:decline" && pending?.delete(client.userId)) {
              sendToCallParticipants(callId, "call:participant-declined", {
                participantId: client.userId,
              });
              if (pending.size === 0) pendingCallParticipants.delete(callId);
              break;
            }
            if (!participants.has(client.userId)) break;

            if (msg.type === "call:decline" && !activeCallIds.has(callId)) {
              sendToCallParticipants(callId, "call:decline", {
                ...msg.payload,
                fromUserId: client.userId,
              }, clientId);
              clearCall(callId);
              break;
            }

            if (msg.type === "call:hangup" || msg.type === "call:decline") {
              participants.delete(client.userId);
              if (participants.size <= 1) {
                sendToCallParticipants(callId, "call:hangup", {
                  fromUserId: client.userId,
                });
                for (const pendingUserId of pending ?? []) {
                  for (const pendingClient of clients.values()) {
                    if (pendingClient.userId === pendingUserId && pendingClient.ws.readyState === WebSocket.OPEN) {
                      pendingClient.ws.send(JSON.stringify({
                        type: "call:hangup",
                        callId,
                        payload: { callId },
                      }));
                    }
                  }
                }
                clearCall(callId);
              } else {
                sendToCallParticipants(callId, "call:participant-left", {
                  participantId: client.userId,
                });
                sendParticipantSnapshot(callId);
              }
            }
            break;
          }

          case "webrtc:signal": {
            const callId = msg.callId;
            const participants = callId ? callParticipants.get(callId) : undefined;
            const targetUserId = msg.payload?.toUserId;
            if (!callId) break;
            if (!client.userId) {
              if (!database) broadcast(msg, clientId);
              break;
            }
            if (!participants) {
              if (!database) broadcast(msg, clientId);
              break;
            }
            if (
              !participants.has(client.userId) ||
              !activeCallIds.has(callId) ||
              (participants.size > 2 && typeof targetUserId !== "string") ||
              (typeof targetUserId === "string" &&
                (targetUserId === client.userId || !participants.has(targetUserId)))
            ) {
              break;
            }
            msg.payload = {
              ...msg.payload,
              fromUserId: client.userId,
              toUserId: targetUserId,
            };
            const raw = JSON.stringify(msg);
            for (const [otherClientId, otherClient] of clients) {
              if (
                otherClientId !== clientId &&
                otherClient.userId &&
                (targetUserId ? otherClient.userId === targetUserId : participants.has(otherClient.userId)) &&
                otherClient.ws.readyState === WebSocket.OPEN
              ) {
                otherClient.ws.send(raw);
              }
            }
            break;
          }

          case "whiteboard:stroke":
          case "whiteboard:clear": {
            if (msg.callId) {
              const participants = callParticipants.get(msg.callId);
              if (!client.userId || !activeCallIds.has(msg.callId) || !participants?.has(client.userId)) break;
              sendToCallParticipants(msg.callId, msg.type, msg.payload ?? {}, clientId);
            } else {
              broadcast(msg, clientId);
            }
            break;
          }

          case "collab:notes":
          case "collab:task":
          {
            if (msg.callId) {
              const participants = callParticipants.get(msg.callId);
              if (!client.userId || !activeCallIds.has(msg.callId) || !participants?.has(client.userId)) break;
              sendToCallParticipants(msg.callId, msg.type, msg.payload ?? {}, clientId);
            } else {
              broadcast(msg, clientId);
            }
            break;
          }

          case "telemetry:sample": {
            if (msg.payload?.sample) {
              const est = pcrEstimator.addSample(msg.payload.sample);
              ws.send(JSON.stringify({
                type: "telemetry:estimate",
                payload: { estimate: est },
              }));
            }
            break;
          }

          default: {
            if (!database) broadcast(msg, clientId);
            break;
          }
        }
      } catch (err) {
        logger.warn({ clientId, error: err instanceof Error ? err.message : "Parse error" }, "Invalid WebSocket message");
      }
    });

    ws.on("close", () => {
      const wasTracked = clients.delete(clientId);
      if (wasTracked) markUserOfflineIfDisconnected(client.userId);
      if (client.userId) {
        for (const [callId, participants] of callParticipants) {
          const stillConnected = Array.from(clients.values()).some((connected) => connected.userId === client.userId);
          if (stillConnected) continue;

          if (pendingCallInvites.get(callId)?.recipientUserId === client.userId) continue;

          const pending = pendingCallParticipants.get(callId);
          if (pending?.delete(client.userId)) {
            sendToCallParticipants(callId, "call:participant-declined", {
              participantId: client.userId,
            });
            if (pending.size === 0) pendingCallParticipants.delete(callId);
          }
          if (!participants.delete(client.userId)) continue;
          if (participants.size <= 1) {
            sendToCallParticipants(callId, "call:hangup", {
              participantId: client.userId,
            });
            const pendingInvite = pendingCallInvites.get(callId);
            if (pendingInvite?.callerUserId === client.userId) {
              dismissCallPush(pendingInvite.recipientUserId, callId);
            }
            clearCall(callId);
          } else {
            sendToCallParticipants(callId, "call:participant-left", {
              participantId: client.userId,
            });
            sendParticipantSnapshot(callId);
          }
        }
      }
      logger.info({ clientId, userId: client.userId }, "WebSocket client disconnected");
      if (wasTracked) broadcastPresence();
    });

    ws.on("error", (err) => {
      logger.error({ clientId, error: err.message }, "WebSocket client error");
    });
  });

  // Keep-alive heartbeat interval (25 seconds)
  const heartbeatInterval = setInterval(() => {
    let presenceChanged = false;
    for (const [clientId, client] of clients.entries()) {
      if (!client.isAlive) {
        logger.info({ clientId }, "Terminating inactive WebSocket client");
        client.ws.terminate();
        clients.delete(clientId);
        markUserOfflineIfDisconnected(client.userId);
        presenceChanged ||= Boolean(client.userId);
        continue;
      }
      client.isAlive = false;
      try {
        client.ws.ping();
      } catch {
        client.ws.terminate();
        clients.delete(clientId);
        markUserOfflineIfDisconnected(client.userId);
        presenceChanged ||= Boolean(client.userId);
      }
    }
    if (presenceChanged) broadcastPresence();
  }, 25_000);

  function shutdown() {
    clearInterval(heartbeatInterval);
    for (const client of clients.values()) {
      try {
        client.ws.close(1001, "Server shutting down");
      } catch {}
    }
    wss.close();
  }

  return { wss, clients, shutdown, broadcastReadReceipt, broadcastScheduledMessage, broadcastMessageDeleted };
}
