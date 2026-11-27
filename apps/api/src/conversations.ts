import { randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { ApiError } from "./errors.js";
import type { AppLogger } from "./logger.js";
import {
  createR2AttachmentStorage,
  deleteR2Attachments,
  getR2AttachmentIds,
  getR2AttachmentKey,
} from "./objectStorage.js";
import type { R2AttachmentStorage } from "./objectStorage.js";
import { resolveSessionUserId, SESSION_COOKIE_NAME } from "./auth.js";
import { areUsersConnected } from "./connections.js";
import {
  canPerformGroupAction,
  DEFAULT_GROUP_PERMISSIONS,
  GroupPermissionsSchema,
} from "./groupPermissions.js";
import type { ScheduledMessagePayload } from "./scheduledMessages.js";
import type { PushNotificationPayload } from "./push.js";

const CreateConversationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(["direct", "group", "community-channel"]).default("direct"),
  description: z.string().max(1000).default(""),
  avatar: z.string().max(2048).default(""),
  peerUserId: z.string().uuid().optional(),
  memberIds: z.array(z.string().uuid()).max(100).default([]),
});

const AddMembersSchema = z.object({
  memberIds: z.array(z.string().uuid()).min(1).max(100),
});
const UpdateGroupSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(1000).optional(),
  avatar: z.string().max(2048).optional(),
  groupPermissions: GroupPermissionsSchema.optional(),
}).refine((value) =>
  value.name !== undefined ||
  value.description !== undefined ||
  value.avatar !== undefined ||
  value.groupPermissions !== undefined
);
const UpdateMemberRoleSchema = z.object({
  role: z.enum(["admin", "moderator", "member"]),
});
const UpdateConversationLockSchema = z.object({
  isLocked: z.boolean(),
});
const UpdateDisappearingTimerSchema = z.object({
  hours: z.number().int().min(0).max(720),
});
const SharedContactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(3).max(40)
    .regex(/^\+?[0-9().\-\s]+$/)
    .refine((phone) => (phone.match(/\d/g)?.length ?? 0) >= 3)
    .optional(),
  email: z.string().trim().email().max(254).optional(),
}).strict().refine((contact) => Boolean(contact.phone || contact.email));
const MessageMetadataSchema = z.record(z.string(), z.unknown()).superRefine((metadata, context) => {
  const sharedContact = metadata["sharedContact"];
  if (sharedContact !== undefined && !SharedContactSchema.safeParse(sharedContact).success) {
    context.addIssue({
      code: "custom",
      path: ["sharedContact"],
      message: "Shared contact details are invalid.",
    });
  }
  if (metadata["isForwarded"] !== undefined && typeof metadata["isForwarded"] !== "boolean") {
    context.addIssue({
      code: "custom",
      path: ["isForwarded"],
      message: "Forwarded state must be a boolean.",
    });
  }
  const forwardingCaption = metadata["forwardingCaption"];
  if (
    forwardingCaption !== undefined &&
    (
      typeof forwardingCaption !== "string" ||
      forwardingCaption.length > 1000 ||
      metadata["isForwarded"] !== true
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["forwardingCaption"],
      message: "Forwarding captions must be at most 1000 characters.",
    });
  }
});

const CreateMessageSchema = z.object({
  id: z.string().uuid().optional(),
  text: z.string().max(4000),
  idempotencyKey: z.string().min(1).max(128).optional(),
  attachments: z.array(z.record(z.string(), z.unknown())).optional(),
  voiceNote: z.record(z.string(), z.unknown()).optional(),
  replyToId: z.string().uuid().optional(),
  metadata: MessageMetadataSchema.optional(),
  sharedContact: SharedContactSchema.optional(),
});
const ScheduleMessageSchema = z.object({
  id: z.string().uuid(),
  text: z.string().trim().min(1).max(4000),
  scheduledFor: z.string().datetime(),
  metadata: z.object({
    replyTo: z.object({
      id: z.string().min(1).max(128),
      senderName: z.string().max(120),
      text: z.string().max(4000),
    }).optional(),
    senderId: z.string().max(128).optional(),
    senderName: z.string().max(120).optional(),
    senderAvatar: z.string().max(2048).optional(),
    linkPreviewDisabled: z.boolean().optional(),
  }).default({}),
});

const UpdateMessageSchema = z.object({
  text: z.string().max(4000).optional(),
  metadata: MessageMetadataSchema.optional(),
  attachments: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
  voiceNote: z.record(z.string(), z.unknown()).nullable().optional(),
}).refine((value) =>
  value.text !== undefined ||
  value.metadata !== undefined ||
  value.attachments !== undefined ||
  value.voiceNote !== undefined
);
const PinMessageSchema = z.object({
  isPinned: z.boolean(),
});
const PollSchema = z.object({
  question: z.string().trim().min(1).max(500),
  options: z.array(z.object({
    id: z.string().min(1).max(128),
    text: z.string().trim().min(1).max(200),
    votes: z.array(z.string().min(1).max(128)),
  })).min(2).max(6),
  multipleAnswers: z.boolean().optional(),
}).refine((poll) => new Set(poll.options.map((option) => option.id)).size === poll.options.length);
const PollVoteSchema = z.object({
  optionId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128).optional(),
});

function applyPollVote(
  poll: z.infer<typeof PollSchema>,
  optionId: string,
  userId: string,
) {
  const selectedOption = poll.options.find((option) => option.id === optionId);
  if (!selectedOption) return null;
  const isRemovingVote = selectedOption.votes.includes(userId);
  return {
    ...poll,
    options: poll.options.map((option) => {
      const alreadyVoted = option.votes.includes(userId);
      if (option.id === optionId) {
        return {
          ...option,
          votes: isRemovingVote
            ? option.votes.filter((id) => id !== userId)
            : [...option.votes, userId],
        };
      }
      if (!poll.multipleAnswers && alreadyVoted) {
        return { ...option, votes: option.votes.filter((id) => id !== userId) };
      }
      return option;
    }),
  };
}

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  sender_avatar: string | null;
  text: string;
  attachments: unknown[] | null;
  voice_note: Record<string, unknown> | null;
  status: "pending" | "sent" | "delivered" | "read";
  metadata: Record<string, unknown>;
  created_at: Date | string;
  expires_at?: Date | string | null;
};

type ScheduledMessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  sender_avatar: string | null;
  text: string;
  metadata: Record<string, unknown>;
  scheduled_for: Date | string;
  created_at: Date | string;
  state: "scheduled" | "sent" | "cancelled";
};

type InMemoryScheduledMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  text: string;
  timestamp: string;
  status: "scheduled";
  scheduledFor: string;
  linkPreviewDisabled?: boolean;
  replyTo?: {
    id: string;
    senderName: string;
    text: string;
  };
};

function toScheduledMessage(row: ScheduledMessageRow) {
  return {
    ...(row.metadata["replyTo"] ? { replyTo: row.metadata["replyTo"] } : {}),
    ...(row.metadata["linkPreviewDisabled"] === true ? { linkPreviewDisabled: true } : {}),
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    senderAvatar: row.sender_avatar ?? "",
    text: row.text,
    timestamp: new Date(row.created_at).toISOString(),
    status: "scheduled" as const,
    scheduledFor: new Date(row.scheduled_for).toISOString(),
  };
}

function toMessage(row: MessageRow) {
  return {
    ...row.metadata,
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    senderAvatar: row.sender_avatar ?? "",
    text: row.text,
    timestamp: new Date(row.created_at).toISOString(),
    status: row.status,
    ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}),
    ...(row.attachments ? { attachments: row.attachments } : {}),
    ...(row.voice_note ? { voiceNote: row.voice_note } : {}),
  };
}

export function createConversationsRouter(
  database: Pool | undefined,
  logger: AppLogger,
  notifyReadReceipt?: (conversationId: string, readerId: string, messageIds: string[]) => Promise<void>,
  notifyScheduledMessage?: (message: ScheduledMessagePayload) => Promise<void>,
  providedAttachmentStorage?: R2AttachmentStorage,
  notifyMessageDeleted?: (payload: {
    messageId: string;
    conversationId: string;
    deletedBy: string;
    ghostUnsend?: boolean;
    moderated?: boolean;
  }) => Promise<void>,
  notifyPushToUser?: (userId: string, payload: PushNotificationPayload) => Promise<void>,
) {
  const router = Router();
  const attachmentStorage = providedAttachmentStorage ?? createR2AttachmentStorage();
  const inMemoryConversations: Array<{
    id: string;
    type: string;
    name: string;
    description: string;
    avatar: string;
    disappearingTimerHours: number;
    createdAt: string;
    updatedAt: string;
  }> = [];
  const inMemoryMessages = new Map<string, Array<{
    id: string;
    conversationId: string;
    text: string;
    createdAt: string;
    status: string;
    metadata: Record<string, unknown>;
    idempotencyKey?: string;
    expiresAt?: string;
  }>>();
  const inMemoryScheduledMessages = new Map<string, InMemoryScheduledMessage[]>();
  let inMemoryScheduleTimer: NodeJS.Timeout | null = null;

  function scheduleInMemoryDelivery() {
    if (inMemoryScheduleTimer || inMemoryScheduledMessages.size === 0) return;
    inMemoryScheduleTimer = setTimeout(() => {
      inMemoryScheduleTimer = null;
      const now = Date.now();
      for (const [conversationId, scheduledMessages] of inMemoryScheduledMessages) {
        const pending = scheduledMessages.filter((message) => Date.parse(message.scheduledFor) > now);
        const due = scheduledMessages.filter((message) => Date.parse(message.scheduledFor) <= now);
        for (const message of due) {
          const createdAt = new Date();
          const timestamp = createdAt.toISOString();
          const timerHours = inMemoryConversations.find((conversation) => conversation.id === conversationId)
            ?.disappearingTimerHours ?? 0;
          const expiresAt = timerHours > 0
            ? new Date(createdAt.getTime() + timerHours * 60 * 60 * 1000).toISOString()
            : undefined;
          const delivered: ScheduledMessagePayload = {
            ...message,
            timestamp,
            status: "sent",
            ...(expiresAt ? { expiresAt } : {}),
          };
          const conversationMessages = inMemoryMessages.get(conversationId) ?? [];
          conversationMessages.push({
            id: delivered.id,
            conversationId,
            text: delivered.text,
            createdAt: timestamp,
            status: "sent",
            metadata: delivered,
            ...(expiresAt ? { expiresAt } : {}),
          });
          inMemoryMessages.set(conversationId, conversationMessages);
          if (notifyScheduledMessage) {
            void notifyScheduledMessage(delivered).catch((error: unknown) => {
              logger.error({
                messageId: delivered.id,
                errorName: error instanceof Error ? error.name : "UnknownError",
              }, "Failed to broadcast an in-memory scheduled message");
            });
          }
        }
        if (pending.length > 0) inMemoryScheduledMessages.set(conversationId, pending);
        else inMemoryScheduledMessages.delete(conversationId);
      }
      scheduleInMemoryDelivery();
    }, 1_000);
    inMemoryScheduleTimer.unref();
  }

  async function getUserId(request: Request) {
    try {
      const userId = await resolveSessionUserId(database, request.cookies?.[SESSION_COOKIE_NAME]);
      if (!userId) throw new ApiError(401, "UNAUTHENTICATED", "Sign in to access conversations.");
      return userId;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Failed to verify conversation session");
      throw new ApiError(503, "AUTHENTICATION_UNAVAILABLE", "Could not verify the current session.");
    }
  }

  async function requireMembership(conversationId: string, userId: string) {
    const membership = await database!.query(
      `SELECT 1 FROM app_conversation_members own
       WHERE own.conversation_id = $1 AND own.user_id = $2
         AND (
           NOT EXISTS (
             SELECT 1 FROM app_conversations conversation
             WHERE conversation.id = own.conversation_id AND conversation.type = 'direct'
           )
           OR EXISTS (
             SELECT 1
             FROM app_conversation_members peer
             JOIN app_user_connections connection
               ON connection.user_low = LEAST(own.user_id, peer.user_id)
              AND connection.user_high = GREATEST(own.user_id, peer.user_id)
             WHERE peer.conversation_id = own.conversation_id
               AND peer.user_id <> own.user_id
               AND NOT EXISTS (
                 SELECT 1 FROM app_user_blocks block
                 WHERE (block.blocker_id = own.user_id AND block.blocked_id = peer.user_id)
                    OR (block.blocker_id = peer.user_id AND block.blocked_id = own.user_id)
               )
           )
         )`,
      [conversationId, userId],
    );
    if (membership.rows.length === 0) {
      throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Conversation not found.");
    }
  }

  async function normalizeR2Attachments(
    attachments: unknown[] | undefined,
    conversationId: string,
    userId: string,
  ): Promise<unknown[] | undefined> {
    if (!attachments) return undefined;
    return Promise.all(attachments.map(async (attachment) => {
      if (typeof attachment !== "object" || attachment === null || !("storage" in attachment) || attachment.storage !== "r2") {
        return attachment;
      }
      const attachmentId = "id" in attachment ? z.string().uuid().safeParse(attachment.id) : undefined;
      if (!attachmentId?.success) {
        throw new ApiError(400, "INVALID_ATTACHMENT", "Attachment reference is invalid.");
      }
      let destinationAttachmentId = attachmentId.data;
      const sourceUrl = "url" in attachment && typeof attachment.url === "string"
        ? /^\/api\/conversations\/([0-9a-f-]{36})\/attachments\/([0-9a-f-]{36})$/i.exec(attachment.url)
        : null;
      const sourceConversationId = sourceUrl?.[1];
      if (sourceConversationId && sourceUrl?.[2]?.toLowerCase() === attachmentId.data.toLowerCase() &&
        sourceConversationId !== conversationId) {
        await requireMembership(sourceConversationId, userId);
        const sourceKey = getR2AttachmentKey(sourceConversationId, attachmentId.data);
        const sourceMetadata = await attachmentStorage.headObject(sourceKey);
        if (
          sourceMetadata.metadata["conversationid"] !== sourceConversationId ||
          sourceMetadata.metadata["attachmentid"] !== attachmentId.data
        ) {
          throw new ApiError(403, "ATTACHMENT_ACCESS_DENIED", "Attachment does not belong to its source conversation.");
        }
        const sourceObject = await attachmentStorage.getObject(sourceKey);
        destinationAttachmentId = randomUUID();
        await attachmentStorage.uploadObject(
          getR2AttachmentKey(conversationId, destinationAttachmentId),
          sourceObject.body,
          sourceObject.contentType ?? sourceMetadata.contentType ?? "application/octet-stream",
          {
            conversationid: conversationId,
            attachmentid: destinationAttachmentId,
            uploaderid: userId,
            attachmenttype: sourceMetadata.metadata["attachmenttype"] ?? "file",
          },
          sourceObject.contentLength ?? sourceMetadata.contentLength,
        );
      }

      const objectKey = getR2AttachmentKey(conversationId, destinationAttachmentId);
      const storedObject = await attachmentStorage.headObject(objectKey);
      if (
        storedObject.metadata["conversationid"] !== conversationId ||
        storedObject.metadata["attachmentid"] !== destinationAttachmentId
      ) {
        throw new ApiError(403, "ATTACHMENT_ACCESS_DENIED", "Attachment does not belong to this conversation.");
      }
      return {
        ...attachment,
        id: destinationAttachmentId,
        url: `/api/conversations/${encodeURIComponent(conversationId)}/attachments/${destinationAttachmentId}`,
      };
    }));
  }

  async function removeR2Attachments(conversationId: string, attachments: unknown): Promise<void> {
    if (getR2AttachmentIds(attachments).length === 0) return;
    try {
      await deleteR2Attachments(attachmentStorage, conversationId, attachments);
    } catch (error) {
      logger.error({
        conversationId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "Failed to delete conversation attachment from Cloudflare R2");
      throw error;
    }
  }

  async function notifyDeletedMessage(payload: {
    messageId: string;
    conversationId: string;
    deletedBy: string;
    ghostUnsend?: boolean;
    moderated?: boolean;
  }): Promise<void> {
    if (!notifyMessageDeleted) return;
    try {
      await notifyMessageDeleted(payload);
    } catch (error) {
      logger.error({
        messageId: payload.messageId,
        conversationId: payload.conversationId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "Message was deleted but realtime notification failed");
    }
  }

  router.post("/:id/attachments/:attachmentId", async (request, response, next) => {
    const conversationId = request.params["id"] ?? "";
    const attachmentId = request.params["attachmentId"] ?? "";
    if (!z.string().uuid().safeParse(conversationId).success || !z.string().uuid().safeParse(attachmentId).success) {
      next(new ApiError(400, "INVALID_ATTACHMENT_ID", "Valid conversation and attachment IDs are required."));
      return;
    }
    const attachmentType = z.enum(["image", "file", "video", "audio"]).safeParse(request.get("x-attachment-type"));
    if (!attachmentType.success) {
      next(new ApiError(400, "INVALID_ATTACHMENT_TYPE", "A valid attachment type is required."));
      return;
    }
    let fileName: string;
    try {
      fileName = decodeURIComponent(request.get("x-file-name") ?? "")
        .replace(/[\/\\\0-\x1f\x7f]/g, "_")
        .trim();
    } catch {
      next(new ApiError(400, "INVALID_ATTACHMENT_NAME", "A valid attachment file name is required."));
      return;
    }
    if (!fileName || fileName.length > 255) {
      next(new ApiError(400, "INVALID_ATTACHMENT_NAME", "A valid attachment file name is required."));
      return;
    }
    const rawContentType = request.get("x-file-content-type")?.trim() || "application/octet-stream";
    const contentType = /^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/.test(rawContentType)
      ? rawContentType
      : "application/octet-stream";

    try {
      if (!database) {
        throw new ApiError(503, "ATTACHMENT_STORAGE_UNAVAILABLE", "Persistent storage is required to upload attachments.");
      }
      const userId = await getUserId(request);
      await requireMembership(conversationId, userId);
      const access = await getGroupPermissionContext(conversationId, userId);
      requireGroupPermission(access, "sendMedia", "send media");

      let sizeBytes = 0;
      const countedBody = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          sizeBytes += chunk.length;
          callback(null, chunk);
        },
      });
      const declaredLengthHeader = request.headers["content-length"];
      const declaredLength =
        typeof declaredLengthHeader === "string" && /^\d+$/.test(declaredLengthHeader)
          ? Number(declaredLengthHeader)
          : undefined;
      const objectKey = getR2AttachmentKey(conversationId, attachmentId);
      const bodyPipeline = pipeline(request, countedBody);
      const upload = attachmentStorage.uploadObject(
        objectKey,
        countedBody,
        contentType,
        {
          conversationid: conversationId,
          attachmentid: attachmentId,
          uploaderid: userId,
          attachmenttype: attachmentType.data,
        },
        declaredLength && Number.isSafeInteger(declaredLength) ? declaredLength : undefined,
      ).catch((error: unknown) => {
        countedBody.destroy(error instanceof Error ? error : new Error("Attachment upload failed."));
        throw error;
      });
      await Promise.all([bodyPipeline, upload]);

      response.status(201).json({
        attachment: {
          id: attachmentId,
          storage: "r2",
          type: attachmentType.data,
          name: fileName,
          sizeBytes,
          url: `/api/conversations/${encodeURIComponent(conversationId)}/attachments/${attachmentId}`,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id/attachments/:attachmentId", async (request, response, next) => {
    const conversationId = request.params["id"] ?? "";
    const attachmentId = request.params["attachmentId"] ?? "";
    if (!z.string().uuid().safeParse(conversationId).success || !z.string().uuid().safeParse(attachmentId).success) {
      next(new ApiError(400, "INVALID_ATTACHMENT_ID", "Valid conversation and attachment IDs are required."));
      return;
    }

    try {
      if (!database) {
        throw new ApiError(503, "ATTACHMENT_STORAGE_UNAVAILABLE", "Persistent storage is required to download attachments.");
      }
      const userId = await getUserId(request);
      await requireMembership(conversationId, userId);
      const objectKey = getR2AttachmentKey(conversationId, attachmentId);
      const metadata = await attachmentStorage.headObject(objectKey);
      if (
        metadata.metadata["conversationid"] !== conversationId ||
        metadata.metadata["attachmentid"] !== attachmentId
      ) {
        throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found.");
      }
      const object = await attachmentStorage.getObject(objectKey);
      response.status(200);
      response.setHeader("Content-Type", object.contentType ?? metadata.contentType ?? "application/octet-stream");
      response.setHeader("Content-Disposition", "inline");
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      if (object.contentLength !== undefined) response.setHeader("Content-Length", object.contentLength);
      object.body.on("error", (error: Error) => {
        logger.error({
          attachmentId,
          conversationId,
          errorName: error.name,
        }, "Cloudflare R2 attachment download stream failed");
        response.destroy(error);
      });
      object.body.pipe(response);
    } catch (error) {
      next(error);
    }
  });

  async function requireGroupAdmin(conversationId: string, userId: string) {
    const membership = await database!.query<{ role: string; type: string }>(
      `SELECT member.role, conversation.type
       FROM app_conversation_members member
       JOIN app_conversations conversation ON conversation.id = member.conversation_id
       WHERE member.conversation_id = $1 AND member.user_id = $2`,
      [conversationId, userId],
    );
    const row = membership.rows[0];
    if (!row || row.type !== "group") {
      throw new ApiError(404, "GROUP_NOT_FOUND", "Group not found.");
    }
    if (row.role !== "owner" && row.role !== "admin") {
      throw new ApiError(403, "GROUP_ADMIN_REQUIRED", "Only group admins can manage members or group details.");
    }
    return row.role;
  }

  async function getGroupPermissionContext(conversationId: string, userId: string) {
    const result = await database!.query<{
      type: string;
      role: string;
      group_permissions: unknown;
    }>(
      `SELECT conversation.type, member.role, conversation.group_permissions
       FROM app_conversation_members member
       JOIN app_conversations conversation ON conversation.id = member.conversation_id
       WHERE member.conversation_id = $1 AND member.user_id = $2`,
      [conversationId, userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Conversation not found.");
    }
    return {
      type: row.type,
      role: row.role,
      permissions: row.type === "group"
        ? GroupPermissionsSchema.parse(row.group_permissions ?? DEFAULT_GROUP_PERMISSIONS)
        : DEFAULT_GROUP_PERMISSIONS,
    };
  }

  function requireGroupPermission(
    access: Awaited<ReturnType<typeof getGroupPermissionContext>>,
    permission: keyof typeof DEFAULT_GROUP_PERMISSIONS,
    action: string,
  ) {
    if (
      access.type === "group" &&
      !canPerformGroupAction(access.role, access.permissions[permission])
    ) {
      throw new ApiError(403, "GROUP_PERMISSION_DENIED", `Only group admins can ${action}.`);
    }
  }

  router.get("/", async (request, response, next) => {
    if (!database) {
      const deduplicatedInMemory = [];
      const seenDirectPeers = new Set<string>();
      for (const conversation of inMemoryConversations) {
        if (conversation.type === "direct" && "peerUserId" in conversation) {
          const peerUserId = conversation.peerUserId as string;
          if (seenDirectPeers.has(peerUserId)) continue;
          seenDirectPeers.add(peerUserId);
        }
        deduplicatedInMemory.push(conversation);
      }
      response.status(200).json({ conversations: deduplicatedInMemory });
      return;
    }

    try {
      const userId = await getUserId(request);
      const result = await database.query<{
        id: string;
        type: string;
        current_user_role: "owner" | "admin" | "moderator" | "member";
        is_locked: boolean;
        members: Array<{
          id: string;
          name: string;
          avatar: string;
          role: "owner" | "admin" | "moderator" | "member";
        }> | null;
        name: string | null;
        description: string | null;
        avatar: string | null;
        peer_user_id: string | null;
        peer_name: string | null;
        peer_avatar: string | null;
        peer_phone: string | null;
        peer_last_seen_at: Date | string | null;
        last_message_id: string | null;
        last_message_conversation_id: string | null;
        last_message_sender_id: string | null;
        last_message_sender_name: string | null;
        last_message_sender_avatar: string | null;
        last_message_text: string | null;
        last_message_attachments: unknown[] | null;
        last_message_voice_note: Record<string, unknown> | null;
        last_message_status: MessageRow["status"] | null;
        last_message_metadata: Record<string, unknown> | null;
        last_message_created_at: Date | string | null;
        last_message_expires_at: Date | string | null;
        disappearing_timer_hours: number;
        group_permissions: unknown;
        updated_at: Date | string;
      }>(
        `SELECT c.id, c.type, c.name, c.description, c.avatar, c.disappearing_timer_hours,
                c.group_permissions, c.updated_at,
                own.role AS current_user_role, own.is_locked, group_members.members,
                peer.id AS peer_user_id, peer.display_name AS peer_name,
                peer.avatar AS peer_avatar, peer.phone AS peer_phone,
                peer.last_seen_at AS peer_last_seen_at,
                latest.id AS last_message_id, latest.conversation_id AS last_message_conversation_id,
                latest.sender_id AS last_message_sender_id, sender.display_name AS last_message_sender_name,
                sender.avatar AS last_message_sender_avatar, latest.text AS last_message_text,
                latest.attachments AS last_message_attachments, latest.voice_note AS last_message_voice_note,
                latest.status AS last_message_status, latest.metadata AS last_message_metadata,
                latest.created_at AS last_message_created_at, latest.expires_at AS last_message_expires_at
         FROM app_conversation_members own
         JOIN app_conversations c ON c.id = own.conversation_id
         LEFT JOIN LATERAL (
           SELECT u.id, u.display_name, u.avatar, u.phone, u.last_seen_at
           FROM app_conversation_members other
           JOIN app_users u ON u.id = other.user_id
           WHERE other.conversation_id = c.id AND other.user_id <> $1
           ORDER BY other.joined_at
           LIMIT 1
         ) peer ON c.type = 'direct'
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object(
             'id', member.user_id,
             'name', u.display_name,
             'avatar', COALESCE(u.avatar, ''),
             'role', member.role
           ) ORDER BY member.joined_at) AS members
           FROM app_conversation_members member
           JOIN app_users u ON u.id = member.user_id
           WHERE member.conversation_id = c.id
         ) group_members ON c.type IN ('group', 'channel')
         LEFT JOIN LATERAL (
           SELECT m.*
           FROM app_messages m
           WHERE m.conversation_id = c.id
             AND (m.expires_at IS NULL OR m.expires_at > now())
           ORDER BY m.created_at DESC
           LIMIT 1
         ) latest ON true
         LEFT JOIN app_users sender ON sender.id = latest.sender_id
         WHERE own.user_id = $1
           AND (
             c.type <> 'direct'
             OR (
               EXISTS (
                 SELECT 1 FROM app_user_connections connection
                 WHERE connection.user_low = LEAST($1::uuid, peer.id)
                   AND connection.user_high = GREATEST($1::uuid, peer.id)
               )
               AND NOT EXISTS (
                 SELECT 1 FROM app_user_blocks block
                 WHERE (block.blocker_id = $1 AND block.blocked_id = peer.id)
                    OR (block.blocker_id = peer.id AND block.blocked_id = $1)
               )
             )
           )
         ORDER BY c.updated_at DESC
         LIMIT 100`,
        [userId],
      );
      const conversations = result.rows.map((row) => ({
        id: row.id,
        type: row.type === "channel" ? "community-channel" : row.type,
        name: row.type === "direct" ? row.peer_name ?? row.name ?? "Conversation" : row.name ?? "Conversation",
        description: row.description ?? "",
        avatar: row.type === "direct" ? row.peer_avatar ?? row.avatar ?? "" : row.avatar ?? "",
        currentUserRole: row.current_user_role,
        isLocked: row.is_locked,
        disappearingTimerHours: row.disappearing_timer_hours,
        ...(row.type === "group"
          ? { groupPermissions: GroupPermissionsSchema.parse(row.group_permissions ?? DEFAULT_GROUP_PERMISSIONS) }
          : {}),
        ...(row.members ? { members: row.members } : {}),
        ...(row.peer_user_id ? { peerUserId: row.peer_user_id } : {}),
        ...(row.peer_phone ? { peerPhone: row.peer_phone } : {}),
        ...(row.peer_last_seen_at
          ? { lastSeen: new Date(row.peer_last_seen_at).toISOString() }
          : {}),
        unreadCount: 0,
        updatedAt: new Date(row.updated_at).toISOString(),
        ...(row.last_message_id ? {
          lastMessage: toMessage({
            id: row.last_message_id,
            conversation_id: row.last_message_conversation_id!,
            sender_id: row.last_message_sender_id!,
            sender_name: row.last_message_sender_name!,
            sender_avatar: row.last_message_sender_avatar,
            text: row.last_message_text!,
            attachments: row.last_message_attachments,
            voice_note: row.last_message_voice_note,
            status: row.last_message_status!,
            metadata: row.last_message_metadata ?? {},
            created_at: row.last_message_created_at!,
            expires_at: row.last_message_expires_at,
          }),
        } : {}),
      }));
      const deduplicatedConversations = [];
      const seenDirectPeers = new Set<string>();
      for (const conversation of conversations) {
        if (conversation.type === "direct" && conversation.peerUserId) {
          if (seenDirectPeers.has(conversation.peerUserId)) continue;
          seenDirectPeers.add(conversation.peerUserId);
        }
        deduplicatedConversations.push(conversation);
      }
      response.status(200).json({ conversations: deduplicatedConversations });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (request, response, next) => {
    const parsed = CreateConversationSchema.safeParse(request.body);
    if (!parsed.success) {
      next(new ApiError(400, "INVALID_CONVERSATION", "Valid conversation details are required."));
      return;
    }

    const { name, type, description, avatar, peerUserId, memberIds } = parsed.data;
    if (type === "direct" && !peerUserId) {
      next(new ApiError(400, "PEER_REQUIRED", "A registered peer is required for a direct conversation."));
      return;
    }
    if (type === "group" && memberIds.length === 0) {
      next(new ApiError(400, "GROUP_MEMBERS_REQUIRED", "Select at least one member to create a group."));
      return;
    }

    if (database) {
      try {
        const userId = await getUserId(request);
        if (type === "direct" && !(await areUsersConnected(database, userId, peerUserId!))) {
          throw new ApiError(403, "CONNECTION_REQUIRED", "Accept a connection request before starting a chat.");
        }
        const client = await database.connect();
        try {
          await client.query("BEGIN");
          if (type === "direct") {
            const existing = await client.query<{
              id: string;
              name: string;
              description: string;
              avatar: string;
              peer_name: string | null;
              peer_avatar: string | null;
              peer_phone: string | null;
              is_locked: boolean;
              current_user_role: "owner" | "admin" | "moderator" | "member";
            }>(
              `SELECT c.id, c.name, c.description, c.avatar,
                      peer.display_name AS peer_name, peer.avatar AS peer_avatar,
                      peer.phone AS peer_phone, own.is_locked, own.role AS current_user_role
               FROM app_conversation_members own
               JOIN app_conversations c ON c.id = own.conversation_id
               JOIN app_conversation_members peer_member
                 ON peer_member.conversation_id = c.id AND peer_member.user_id = $2
               JOIN app_users peer ON peer.id = peer_member.user_id
               WHERE own.user_id = $1 AND c.type = 'direct'
                 AND (SELECT count(*) FROM app_conversation_members member
                      WHERE member.conversation_id = c.id) = 2
               ORDER BY c.updated_at DESC
               LIMIT 1`,
              [userId, peerUserId],
            );
            if (existing.rows[0]) {
              const row = existing.rows[0];
              await client.query("COMMIT");
              response.status(201).json({
                conversation: {
                  id: row.id,
                  type: "direct",
                  name: row.peer_name ?? row.name ?? "Conversation",
                  description: row.description ?? "",
                  avatar: row.peer_avatar ?? row.avatar ?? "",
                  peerUserId,
                  peerPhone: row.peer_phone ?? undefined,
                  isLocked: row.is_locked,
                  currentUserRole: row.current_user_role,
                  unreadCount: 0,
                  updatedAt: new Date().toISOString(),
                },
              });
              return;
            }
          }
          const dbType = type === "community-channel" ? "channel" : type;
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO app_conversations (type, name, description, avatar)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [dbType, name, description, avatar],
          );
          const conversationId = inserted.rows[0]?.id;
          if (!conversationId) throw new Error("Conversation insert returned no ID.");
          await client.query(
            "INSERT INTO app_conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'owner')",
            [conversationId, userId],
          );
          const participants = type === "direct"
            ? [peerUserId!]
            : memberIds.filter((id) => id !== userId);
          for (const memberId of new Set(participants)) {
            const user = await client.query("SELECT 1 FROM app_users WHERE id = $1", [memberId]);
            if (user.rowCount === 0) {
              throw new ApiError(400, "INVALID_MEMBER", "One or more conversation members do not exist.");
            }
            await client.query(
              "INSERT INTO app_conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'member')",
              [conversationId, memberId],
            );
          }
          const groupMembers = type === "group"
            ? await client.query<{
              id: string;
              name: string;
              avatar: string;
              role: "owner" | "admin" | "moderator" | "member";
            }>(
              `SELECT member.user_id AS id, user_profile.display_name AS name,
                      COALESCE(user_profile.avatar, '') AS avatar, member.role
               FROM app_conversation_members member
               JOIN app_users user_profile ON user_profile.id = member.user_id
               WHERE member.conversation_id = $1
               ORDER BY member.joined_at`,
              [conversationId],
            )
            : undefined;
          await client.query("COMMIT");
          response.status(201).json({
            conversation: {
              id: conversationId,
              type,
              name,
              description,
              avatar,
              peerUserId: type === "direct" ? peerUserId : undefined,
              unreadCount: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              currentUserRole: "owner",
              ...(type === "group" ? { groupPermissions: DEFAULT_GROUP_PERMISSIONS } : {}),
              ...(groupMembers ? { members: groupMembers.rows } : {}),
            },
          });

        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      } catch (error) {
        if (!(error instanceof ApiError)) {
          logger.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Failed to create conversation");
          next(new ApiError(500, "DATABASE_ERROR", "Could not create conversation."));
          return;
        }
        next(error);
      }
      return;
    }

    const newConv = {
      id: `conv-${randomUUID()}`,
      type,
      name,
      description,
      avatar: avatar || "/avatars/boy.png",
      disappearingTimerHours: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(peerUserId ? { peerUserId } : {}),
      unreadCount: 0,
    };
    if (type === "direct" && peerUserId) {
      const existing = inMemoryConversations.find((conversation) =>
        conversation.type === "direct" &&
        "peerUserId" in conversation &&
        conversation.peerUserId === peerUserId
      );
      if (existing) {
        response.status(201).json({ conversation: existing });
        return;
      }
    }
    inMemoryConversations.unshift(newConv);
    response.status(201).json({ conversation: newConv });
  });

  router.patch("/:id", async (request, response, next) => {
    const conversationId = request.params["id"] ?? "";
    const parsed = UpdateGroupSchema.safeParse(request.body);
    if (!parsed.success) {
      next(new ApiError(400, "INVALID_GROUP_UPDATE", "Valid group details are required."));
      return;
    }
    if (!database) {
      next(new ApiError(503, "DATABASE_UNAVAILABLE", "Group management requires the database."));
      return;
    }
    try {
      const userId = await getUserId(request);
      const updates = parsed.data;
      const access = await getGroupPermissionContext(conversationId, userId);
      if (access.type !== "group") {
        throw new ApiError(404, "GROUP_NOT_FOUND", "Group not found.");
      }
      const isAdmin = access.role === "owner" || access.role === "admin";
      if (updates.groupPermissions && !isAdmin) {
        throw new ApiError(403, "GROUP_ADMIN_REQUIRED", "Only group admins can change group permissions.");
      }
      if (
        (updates.name !== undefined || updates.description !== undefined || updates.avatar !== undefined) &&
        !canPerformGroupAction(access.role, access.permissions.editGroupInfo)
      ) {
        throw new ApiError(403, "GROUP_PERMISSION_DENIED", "Only group admins can edit group information.");
      }
      const result = await database.query(
        `UPDATE app_conversations
         SET name = COALESCE($1, name),
             description = COALESCE($2, description),
             avatar = COALESCE($3, avatar),
             group_permissions = COALESCE($4::jsonb, group_permissions),
             updated_at = now()
         WHERE id = $5 AND type = 'group'
         RETURNING id`,
        [
          updates.name ?? null,
          updates.description ?? null,
          updates.avatar ?? null,
          updates.groupPermissions ? JSON.stringify(updates.groupPermissions) : null,
          conversationId,
        ],
      );
      if (result.rowCount === 0) {
        next(new ApiError(404, "GROUP_NOT_FOUND", "Group not found."));
        return;
      }
      response.status(200).json({ updated: true });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id/lock", async (request, response, next) => {
    const conversationId = request.params["id"] ?? "";
    const parsed = UpdateConversationLockSchema.safeParse(request.body);
    if (!parsed.success) {
      next(new ApiError(400, "INVALID_CONVERSATION_LOCK", "A valid conversation lock setting is required."));
      return;
    }
    if (!database) {
      next(new ApiError(503, "DATABASE_UNAVAILABLE", "Conversation lock settings require the database."));
      return;
    }
    try {
      const userId = await getUserId(request);
      const result = await database.query<{ is_locked: boolean }>(
        `UPDATE app_conversation_members
         SET is_locked = $3
         WHERE conversation_id = $1 AND user_id = $2
         RETURNING is_locked`,
        [conversationId, userId, parsed.data.isLocked],
      );
      const row = result.rows[0];
      if (!row) {
        next(new ApiError(404, "CONVERSATION_NOT_FOUND", "Conversation not found."));
        return;
      }
      response.status(200).json({ isLocked: row.is_locked });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id/disappearing-timer", async (request, response, next) => {
    const conversationId = request.params["id"] ?? "";
    const parsed = UpdateDisappearingTimerSchema.safeParse(request.body);
    if (!parsed.success) {
      next(new ApiError(400, "INVALID_DISAPPEARING_TIMER", "Choose a timer between off and 30 days."));
      return;
    }

    if (!database) {
      const conversation = inMemoryConversations.find((item) => item.id === conversationId);
      if (!conversation) {
        next(new ApiError(404, "CONVERSATION_NOT_FOUND", "Conversation not found."));
        return;
      }
      conversation.disappearingTimerHours = parsed.data.hours;
      response.status(200).json({ disappearingTimerHours: conversation.disappearingTimerHours });
      return;
    }

    try {
      const userId = await getUserId(request);
      await requireMembership(conversationId, userId);
      const updated = await database.query<{ disappearing_timer_hours: number }>(
        `UPDATE app_conversations
         SET disappearing_timer_hours = $3, updated_at = now()
         WHERE id = $1
           AND EXISTS (
             SELECT 1 FROM app_conversation_members member
             WHERE member.conversation_id = app_conversations.id AND member.user_id = $2
           )
         RETURNING disappearing_timer_hours`,
        [conversationId, userId, parsed.data.hours],
      );
      const timerHours = updated.rows[0]?.disappearing_timer_hours;
      if (timerHours === undefined) {
        next(new ApiError(404, "CONVERSATION_NOT_FOUND", "Conversation not found."));
        return;
      }
      response.status(200).json({ disappearingTimerHours: timerHours });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/members", async (request, response, next) => {
    const conversationId = request.params["id"] ?? "";
    const parsed = AddMembersSchema.safeParse(request.body);
    if (!parsed.success) {
      next(new ApiError(400, "INVALID_GROUP_MEMBERS", "Select one or more valid members."));
      return;
    }
    if (!database) {
      next(new ApiError(503, "DATABASE_UNAVAILABLE", "Group management requires the database."));
      return;
    }
    try {
      const userId = await getUserId(request);
      const access = await getGroupPermissionContext(conversationId, userId);
      if (access.type !== "group") {
        throw new ApiError(404, "GROUP_NOT_FOUND", "Group not found.");
      }
      requireGroupPermission(access, "addMembers", "add members");
      const memberIds = Array.from(new Set(parsed.data.memberIds)).filter((id) => id !== userId);
      if (memberIds.length === 0) {
        next(new ApiError(400, "INVALID_GROUP_MEMBERS", "Choose another user to add."));
        return;
      }
      const existing = await database.query<{ user_id: string }>(
        "SELECT user_id FROM app_users WHERE id = ANY($1::uuid[])",
        [memberIds],
      );
      if (existing.rows.length !== memberIds.length) {
        next(new ApiError(400, "INVALID_MEMBER", "One or more selected users do not exist."));
        return;
      }
      const added = await database.query(
        `INSERT INTO app_conversation_members (conversation_id, user_id, role)
         SELECT $1, selected.user_id, 'member'
         FROM unnest($2::uuid[]) AS selected(user_id)
         ON CONFLICT (conversation_id, user_id) DO NOTHING
         RETURNING user_id`,
        [conversationId, memberIds],
      );
      response.status(200).json({ addedMemberIds: added.rows.map((row: { user_id: string }) => row.user_id) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id/members/:memberId", async (request, response, next) => {
    const conversationId = request.params["id"] ?? "";
    const memberId = request.params["memberId"] ?? "";
    const parsed = UpdateMemberRoleSchema.safeParse(request.body);
    if (!z.string().uuid().safeParse(memberId).success || !parsed.success) {
      next(new ApiError(400, "INVALID_MEMBER_ROLE", "A valid member and role are required."));
      return;
    }
    if (!database) {
      next(new ApiError(503, "DATABASE_UNAVAILABLE", "Group management requires the database."));
      return;
    }
    let client: PoolClient | undefined;
    let transactionStarted = false;
    try {
      const userId = await getUserId(request);
      client = await database.connect();
      await client.query("BEGIN");
      transactionStarted = true;
      const actor = await client.query<{ role: string; type: string }>(
        `SELECT member.role, conversation.type
         FROM app_conversation_members member
         JOIN app_conversations conversation ON conversation.id = member.conversation_id
         WHERE member.conversation_id = $1 AND member.user_id = $2
         FOR UPDATE`,
        [conversationId, userId],
      );
      if (!actor.rows[0] || actor.rows[0].type !== "group") {
        throw new ApiError(404, "GROUP_NOT_FOUND", "Group not found.");
      }
      if (actor.rows[0].role !== "owner" && actor.rows[0].role !== "admin") {
        throw new ApiError(403, "GROUP_ADMIN_REQUIRED", "Only group admins can change member roles.");
      }
      const target = await client.query<{ role: string }>(
        `SELECT role FROM app_conversation_members
         WHERE conversation_id = $1 AND user_id = $2
         FOR UPDATE`,
        [conversationId, memberId],
      );
      if (!target.rows[0] || target.rows[0].role === "owner") {
        throw new ApiError(404, "GROUP_MEMBER_NOT_FOUND", "Group member not found or cannot be changed.");
      }
      if (actor.rows[0].role === "admin" && target.rows[0].role === "admin") {
        throw new ApiError(403, "ADMIN_CANNOT_CHANGE_ADMIN", "Admins cannot change another admin's role.");
      }
      if (actor.rows[0].role === "admin" && parsed.data.role === "admin") {
        throw new ApiError(403, "OWNER_REQUIRED_TO_ASSIGN_ADMIN", "Only the group owner can assign admin roles.");
      }
      if (target.rows[0].role === parsed.data.role) {
        await client.query("COMMIT");
        transactionStarted = false;
        response.status(200).json({ updated: true });
        return;
      }
      await client.query(
        `UPDATE app_conversation_members member
         SET role = $1
         FROM app_conversations conversation
         WHERE member.conversation_id = $2 AND member.user_id = $3
           AND member.role <> 'owner' AND conversation.id = member.conversation_id
           AND conversation.type = 'group'
         RETURNING member.user_id`,
        [parsed.data.role, conversationId, memberId],
      );
      await client.query(
        `INSERT INTO app_group_audit_log
         (conversation_id, actor_id, target_user_id, action, details)
         VALUES ($1, $2, $3, 'member_role_changed', $4::jsonb)`,
        [
          conversationId,
          userId,
          memberId,
          JSON.stringify({ previousRole: target.rows[0].role, newRole: parsed.data.role }),
        ],
      );
      await client.query("COMMIT");
      transactionStarted = false;
      response.status(200).json({ updated: true });
    } catch (error) {
      if (client && transactionStarted) await client.query("ROLLBACK");
      next(error);
    } finally {
      client?.release();
    }
  });

  router.get("/:id/audit", async (request, response, next) => {
    const conversationId = request.params["id"] ?? "";
    if (!database) {
      next(new ApiError(503, "DATABASE_UNAVAILABLE", "Group audit history requires the database."));
      return;
    }
    try {
      const userId = await getUserId(request);
      await requireGroupAdmin(conversationId, userId);
      const result = await database.query<{
        id: string;
        action: string;
        details: Record<string, unknown>;
        actor_name: string;
        target_name: string | null;
        created_at: Date | string;
      }>(
        `SELECT audit.id, audit.action, audit.details,
                actor.display_name AS actor_name,
                target.display_name AS target_name,
                audit.created_at
         FROM app_group_audit_log audit
         JOIN app_users actor ON actor.id = audit.actor_id
         LEFT JOIN app_users target ON target.id = audit.target_user_id
         WHERE audit.conversation_id = $1
         ORDER BY audit.created_at DESC
         LIMIT 100`,
        [conversationId],
      );
      response.status(200).json({ events: result.rows });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id/members/:memberId", async (request, response, next) => {
    const conversationId = request.params["id"] ?? "";
    const memberId = request.params["memberId"] ?? "";
    if (!z.string().uuid().safeParse(memberId).success) {
      next(new ApiError(400, "INVALID_MEMBER", "A valid group member is required."));
      return;
    }
    if (!database) {
      next(new ApiError(503, "DATABASE_UNAVAILABLE", "Group management requires the database."));
      return;
    }
    let client: PoolClient | undefined;
    let transactionStarted = false;
    try {
      const userId = await getUserId(request);
      client = await database.connect();
      await client.query("BEGIN");
      transactionStarted = true;
      const memberships = await client.query<{ role: string; type: string }>(
        `SELECT member.role, conversation.type
         FROM app_conversation_members member
         JOIN app_conversations conversation ON conversation.id = member.conversation_id
         WHERE member.conversation_id = $1 AND member.user_id = $2
         FOR UPDATE`,
        [conversationId, userId],
      );
      const actor = memberships.rows[0];
      if (!actor || actor.type !== "group") {
        throw new ApiError(404, "GROUP_NOT_FOUND", "Group not found.");
      }
      const isLeaving = memberId === userId;
      if (!isLeaving && actor.role !== "owner" && actor.role !== "admin" && actor.role !== "moderator") {
        throw new ApiError(403, "GROUP_ADMIN_REQUIRED", "Only group moderators can remove members.");
      }
      const target = await client.query<{ role: string }>(
        `SELECT role FROM app_conversation_members
         WHERE conversation_id = $1 AND user_id = $2
         FOR UPDATE`,
        [conversationId, memberId],
      );
      if (!target.rows[0]) {
        throw new ApiError(404, "GROUP_MEMBER_NOT_FOUND", "Group member not found.");
      }
      if (target.rows[0].role === "owner" && !isLeaving) {
        throw new ApiError(403, "OWNER_CANNOT_BE_REMOVED", "The group owner cannot be removed.");
      }
      if (!isLeaving && actor.role === "moderator" && target.rows[0].role !== "member") {
        throw new ApiError(403, "MODERATOR_CANNOT_REMOVE_PRIVILEGED_MEMBER", "Moderators can only remove regular members.");
      }
      if (!isLeaving && actor.role === "admin" && (target.rows[0].role === "admin" || target.rows[0].role === "moderator")) {
        throw new ApiError(403, "ADMIN_CANNOT_REMOVE_PRIVILEGED_MEMBER", "Admins cannot remove another admin or moderator.");
      }
      await client.query(
        `INSERT INTO app_group_audit_log
         (conversation_id, actor_id, target_user_id, action, details)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          conversationId,
          userId,
          memberId,
          isLeaving ? "member_left" : "member_removed",
          JSON.stringify({ targetRole: target.rows[0].role }),
        ],
      );
      await client.query(
        "DELETE FROM app_conversation_members WHERE conversation_id = $1 AND user_id = $2",
        [conversationId, memberId],
      );
      if (target.rows[0].role === "owner") {
        const nextOwner = await client.query<{ user_id: string }>(
          `SELECT user_id FROM app_conversation_members
           WHERE conversation_id = $1
            ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END, joined_at
           LIMIT 1`,
          [conversationId],
        );
        const ownerId = nextOwner.rows[0]?.user_id;
        if (ownerId) {
          await client.query(
            "UPDATE app_conversation_members SET role = 'owner' WHERE conversation_id = $1 AND user_id = $2",
            [conversationId, ownerId],
          );
          await client.query(
            `INSERT INTO app_group_audit_log
             (conversation_id, actor_id, target_user_id, action, details)
             VALUES ($1, $2, $3, 'owner_transferred', $4::jsonb)`,
            [conversationId, userId, ownerId, JSON.stringify({ previousOwnerId: userId })],
          );
        } else {
          await client.query("DELETE FROM app_conversations WHERE id = $1", [conversationId]);
        }
      }
      await client.query("COMMIT");
      transactionStarted = false;
      response.status(200).json({ removed: true, left: isLeaving });
    } catch (error) {
      if (client && transactionStarted) {
        await client.query("ROLLBACK");
      }
      next(error);
    } finally {
      client?.release();
    }
  });

  router.get("/:id/messages/:messageId/read-receipts", async (request, response, next) => {
    const conversationId = request.params["id"] ?? "";
    const messageId = request.params["messageId"] ?? "";
    if (!z.string().uuid().safeParse(messageId).success) {
      throw new ApiError(400, "INVALID_MESSAGE_ID", "The message id is invalid.");
    }
    if (!database) {
      response.status(200).json({ receipts: [] });
      return;
    }

    try {
      const userId = await getUserId(request);
      await requireMembership(conversationId, userId);
      const message = await database.query<{ sender_id: string }>(
        `SELECT sender_id
         FROM app_messages
         WHERE id = $1 AND conversation_id = $2`,
        [messageId, conversationId],
      );
      if (!message.rows[0]) {
        throw new ApiError(404, "MESSAGE_NOT_FOUND", "Message not found.");
      }
      if (message.rows[0].sender_id !== userId) {
        throw new ApiError(403, "READ_RECEIPTS_FORBIDDEN", "Only the message sender can view its receipts.");
      }

      const result = await database.query(
        `SELECT member.user_id AS "userId",
                recipient.display_name AS name,
                COALESCE(recipient.avatar, '') AS avatar,
                CASE
                  WHEN NOT recipient.read_receipts_enabled THEN 'unavailable'
                  WHEN receipt.message_id IS NULL OR receipt.receipt_state = 'unknown' THEN 'unknown'
                  ELSE receipt.receipt_state
                END AS status,
                CASE WHEN recipient.read_receipts_enabled THEN receipt.delivered_at END AS "deliveredAt",
                CASE WHEN recipient.read_receipts_enabled THEN receipt.read_at END AS "readAt"
         FROM app_conversation_members member
         JOIN app_users recipient ON recipient.id = member.user_id
         JOIN app_messages message
           ON message.id = $1 AND message.conversation_id = member.conversation_id
         LEFT JOIN app_message_receipts receipt
           ON receipt.message_id = message.id AND receipt.user_id = member.user_id
         WHERE member.conversation_id = $2
           AND member.user_id <> message.sender_id
           AND member.joined_at <= message.created_at
         ORDER BY recipient.display_name, member.user_id`,
        [messageId, conversationId],
      );
      response.status(200).json({ receipts: result.rows });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id/messages", async (request, response, next) => {
    const conversationId = request.params["id"] ?? "";
    if (!database) {
      const messages = (inMemoryMessages.get(conversationId) ?? []).map(({ metadata, ...message }) => ({
        ...metadata,
        ...message,
        timestamp: typeof metadata["timestamp"] === "string" ? metadata["timestamp"] : message.createdAt,
      })).filter((message) => !message.expiresAt || Date.parse(message.expiresAt) > Date.now());
      const scheduledMessages = inMemoryScheduledMessages.get(conversationId) ?? [];
      response.status(200).json({
        messages: [...messages, ...scheduledMessages].sort(
          (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
        ),
      });
      return;
    }

    try {
      const userId = await getUserId(request);
      await requireMembership(conversationId, userId);
      const result = await database.query<MessageRow>(
        `SELECT m.id, m.conversation_id, m.sender_id, u.display_name AS sender_name,
                u.avatar AS sender_avatar, m.text, m.attachments, m.voice_note,
               m.status, m.metadata, m.created_at, m.expires_at
         FROM app_messages m
         JOIN app_users u ON u.id = m.sender_id
         WHERE m.conversation_id = $1
           AND (m.expires_at IS NULL OR m.expires_at > now())
           AND (
             m.id IN (
               SELECT recent.id
               FROM app_messages recent
               WHERE recent.conversation_id = $1
                 AND (recent.expires_at IS NULL OR recent.expires_at > now())
               ORDER BY recent.created_at DESC
               LIMIT 100
             )
             OR m.metadata->>'isPinned' = 'true'
           )
         ORDER BY m.created_at DESC
         `,
        [conversationId],
      );
      const scheduled = await database.query<ScheduledMessageRow>(
        `SELECT scheduled.id, scheduled.conversation_id, scheduled.sender_id,
                sender.display_name AS sender_name, sender.avatar AS sender_avatar,
                scheduled.text, scheduled.metadata, scheduled.scheduled_for,
                scheduled.created_at, scheduled.state
         FROM app_scheduled_messages scheduled
         JOIN app_users sender ON sender.id = scheduled.sender_id
         WHERE scheduled.conversation_id = $1
           AND scheduled.sender_id = $2
           AND scheduled.state = 'scheduled'
         ORDER BY scheduled.created_at DESC
         LIMIT 100`,
        [conversationId, userId],
      );
      const messages = [
        ...result.rows.reverse().map(toMessage),
        ...scheduled.rows.map(toScheduledMessage),
      ].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
      response.status(200).json({ messages });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/scheduled-messages", async (request, response, next) => {
    const conversationId = request.params["id"] ?? "";
    const parsed = ScheduleMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      next(new ApiError(400, "INVALID_SCHEDULED_MESSAGE", "Provide a message and a valid delivery time."));
      return;
    }

    const scheduledFor = new Date(parsed.data.scheduledFor);
    if (scheduledFor.getTime() <= Date.now()) {
      next(new ApiError(400, "SCHEDULE_TIME_MUST_BE_FUTURE", "Choose a delivery time in the future."));
      return;
    }

    if (!database) {
      const createdAt = new Date().toISOString();
      const message: InMemoryScheduledMessage = {
        id: parsed.data.id,
        conversationId,
        senderId: parsed.data.metadata.senderId ?? "local-user",
        senderName: parsed.data.metadata.senderName ?? "You",
        senderAvatar: parsed.data.metadata.senderAvatar ?? "",
        text: parsed.data.text,
        timestamp: createdAt,
        status: "scheduled",
        scheduledFor: scheduledFor.toISOString(),
        ...(parsed.data.metadata.linkPreviewDisabled ? { linkPreviewDisabled: true } : {}),
        ...(parsed.data.metadata.replyTo ? { replyTo: parsed.data.metadata.replyTo } : {}),
      };
      const scheduledMessages = inMemoryScheduledMessages.get(conversationId) ?? [];
      const existing = scheduledMessages.find((item) => item.id === message.id);
      if (existing) {
        response.status(200).json({ message: existing, duplicate: true });
        return;
      }
      scheduledMessages.push(message);
      inMemoryScheduledMessages.set(conversationId, scheduledMessages);
      scheduleInMemoryDelivery();
      response.status(201).json({ message });
      return;
    }

    try {
      const userId = await getUserId(request);
      await requireMembership(conversationId, userId);
      const access = await getGroupPermissionContext(conversationId, userId);
      requireGroupPermission(access, "sendMessages", "schedule messages");
      const sender = await database.query<{ display_name: string; avatar: string | null }>(
        "SELECT display_name, avatar FROM app_users WHERE id = $1",
        [userId],
      );
      const senderRow = sender.rows[0];
      if (!senderRow) {
        throw new ApiError(401, "UNAUTHENTICATED", "Sign in to schedule messages.");
      }

      const metadata = {
        ...(parsed.data.metadata.replyTo ? { replyTo: parsed.data.metadata.replyTo } : {}),
        ...(parsed.data.metadata.linkPreviewDisabled ? { linkPreviewDisabled: true } : {}),
      };
      const inserted = await database.query<ScheduledMessageRow>(
        `INSERT INTO app_scheduled_messages
           (id, conversation_id, sender_id, text, metadata, scheduled_for)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING
         RETURNING id, conversation_id, sender_id, text, metadata, scheduled_for, created_at, state`,
        [
          parsed.data.id,
          conversationId,
          userId,
          parsed.data.text,
          JSON.stringify(metadata),
          scheduledFor,
        ],
      );
      const insertedRow = inserted.rows[0];
      if (insertedRow) {
        response.status(201).json({
          message: toScheduledMessage({
            ...insertedRow,
            sender_name: senderRow.display_name,
            sender_avatar: senderRow.avatar,
          }),
        });
        return;
      }

      const existing = await database.query<ScheduledMessageRow>(
        `SELECT scheduled.id, scheduled.conversation_id, scheduled.sender_id,
                sender.display_name AS sender_name, sender.avatar AS sender_avatar,
                scheduled.text, scheduled.metadata, scheduled.scheduled_for,
                scheduled.created_at, scheduled.state
         FROM app_scheduled_messages scheduled
         JOIN app_users sender ON sender.id = scheduled.sender_id
         WHERE scheduled.id = $1 AND scheduled.conversation_id = $2 AND scheduled.sender_id = $3`,
        [parsed.data.id, conversationId, userId],
      );
      const existingScheduledMessage = existing.rows[0];
      if (existingScheduledMessage?.state === "scheduled") {
        response.status(200).json({ message: toScheduledMessage(existingScheduledMessage), duplicate: true });
        return;
      }
      if (existingScheduledMessage?.state === "sent") {
        const delivered = await database.query<MessageRow>(
          `SELECT message.id, message.conversation_id, message.sender_id,
                  sender.display_name AS sender_name, sender.avatar AS sender_avatar,
                  message.text, message.attachments, message.voice_note,
                  message.status, message.metadata, message.created_at
           FROM app_messages message
           JOIN app_users sender ON sender.id = message.sender_id
           WHERE message.id = $1 AND message.conversation_id = $2`,
          [parsed.data.id, conversationId],
        );
        if (delivered.rows[0]) {
          response.status(200).json({ message: toMessage(delivered.rows[0]), duplicate: true });
          return;
        }
      }
      throw new ApiError(409, "SCHEDULED_MESSAGE_CONFLICT", "This scheduled message can no longer be created.");
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id/scheduled-messages/:messageId", async (request, response, next) => {
    const conversationId = request.params["id"] ?? "";
    const messageId = request.params["messageId"] ?? "";
    if (!z.string().uuid().safeParse(messageId).success) {
      next(new ApiError(400, "INVALID_MESSAGE_ID", "A valid message ID is required."));
      return;
    }

    if (!database) {
      const scheduledMessages = inMemoryScheduledMessages.get(conversationId) ?? [];
      const remaining = scheduledMessages.filter((message) => message.id !== messageId);
      if (remaining.length === scheduledMessages.length) {
        next(new ApiError(404, "SCHEDULED_MESSAGE_NOT_FOUND", "Scheduled message not found."));
        return;
      }
      if (remaining.length > 0) inMemoryScheduledMessages.set(conversationId, remaining);
      else inMemoryScheduledMessages.delete(conversationId);
      response.status(200).json({ cancelled: true });
      return;
    }

    try {
      const userId = await getUserId(request);
      const cancelled = await database.query(
        `UPDATE app_scheduled_messages
         SET state = 'cancelled'
         WHERE id = $1 AND conversation_id = $2 AND sender_id = $3 AND state = 'scheduled'
         RETURNING id`,
        [messageId, conversationId, userId],
      );
      if (cancelled.rowCount === 0) {
        throw new ApiError(409, "SCHEDULED_MESSAGE_NOT_CANCELLABLE", "This message has already been delivered or cancelled.");
      }
      response.status(200).json({ cancelled: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/messages", async (request, response, next) => {
    const conversationId = request.params["id"] ?? "";
    const parsed = CreateMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      next(new ApiError(400, "INVALID_MESSAGE_PAYLOAD", "A valid text string is required."));
      return;
    }
    if (
      parsed.data.metadata?.["poll"] !== undefined &&
      !PollSchema.safeParse(parsed.data.metadata["poll"]).success
    ) {
      next(new ApiError(400, "INVALID_POLL", "A valid poll is required."));
      return;
    }

    if (!database) {
      const { idempotencyKey, text, id, metadata, sharedContact } = parsed.data;
      const existingList = inMemoryMessages.get(conversationId) ?? [];
      const duplicate = idempotencyKey
        ? existingList.find((message) => message.idempotencyKey === idempotencyKey)
        : undefined;
      if (duplicate) {
        response.status(200).json({ message: duplicate, duplicate: true });
        return;
      }
      const timerHours = inMemoryConversations.find((conversation) => conversation.id === conversationId)
        ?.disappearingTimerHours ?? 0;
      const createdAt = new Date();
      const message = {
        ...(metadata ?? {}),
        id: id ?? randomUUID(),
        conversationId,
        text,
        createdAt: createdAt.toISOString(),
        status: "sent",
        metadata: {
          ...(metadata ?? {}),
          ...(sharedContact ? { sharedContact } : {}),
        },
        ...(sharedContact ? { sharedContact } : {}),
        ...(timerHours > 0
          ? { expiresAt: new Date(createdAt.getTime() + timerHours * 60 * 60 * 1000).toISOString() }
          : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
      };
      existingList.push(message);
      inMemoryMessages.set(conversationId, existingList);
      logger.info({ messageId: message.id, conversationId }, "Message created");
      response.status(201).json({ message });
      return;
    }

    try {
      const userId = await getUserId(request);
      await requireMembership(conversationId, userId);
      const { id, text, idempotencyKey, attachments, voiceNote, replyToId, metadata, sharedContact } = parsed.data;
      const access = await getGroupPermissionContext(conversationId, userId);
      const hasMedia = (attachments?.length ?? 0) > 0 || Boolean(voiceNote);
      if (metadata?.["poll"] !== undefined) {
        requireGroupPermission(access, "createPolls", "create polls");
      } else if (text.trim() || sharedContact || !hasMedia) {
        requireGroupPermission(access, "sendMessages", "send messages");
      }
      if (hasMedia) {
        requireGroupPermission(access, "sendMedia", "send media");
      }
      const normalizedAttachments = await normalizeR2Attachments(attachments, conversationId, userId);
      const inserted = await database.query<MessageRow>(
        `WITH inserted AS (
           INSERT INTO app_messages
           (id, conversation_id, sender_id, text, attachments, voice_note, reply_to_id, idempotency_key, metadata, expires_at)
           VALUES (
           COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9,
           (SELECT CASE WHEN disappearing_timer_hours > 0
             THEN now() + make_interval(hours => disappearing_timer_hours)
             ELSE NULL END
            FROM app_conversations WHERE id = $2)
           )
           ON CONFLICT (conversation_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
           RETURNING id, conversation_id, sender_id, text, attachments, voice_note, status, metadata, created_at, expires_at
         ),
         receipt_insertions AS (
           INSERT INTO app_message_receipts (message_id, user_id)
           SELECT inserted.id, member.user_id
           FROM inserted
           JOIN app_conversation_members member ON member.conversation_id = inserted.conversation_id
           WHERE member.user_id <> inserted.sender_id
           ON CONFLICT (message_id, user_id) DO NOTHING
           RETURNING message_id
         )
         SELECT inserted.* FROM inserted`,
        [
          id ?? null,
          conversationId,
          userId,
          text,
          normalizedAttachments ? JSON.stringify(normalizedAttachments) : null,
          voiceNote ? JSON.stringify(voiceNote) : null,
          replyToId ?? null,
          idempotencyKey ?? null,
          JSON.stringify({
            ...(metadata ?? {}),
            ...(sharedContact ? { sharedContact } : {}),
          }),
        ],
      );

      if (inserted.rows[0]) {
        await database.query("UPDATE app_conversations SET updated_at = now() WHERE id = $1", [conversationId]);
        const sender = await database.query<{ display_name: string; avatar: string | null }>(
          "SELECT display_name, avatar FROM app_users WHERE id = $1",
          [userId],
        );
        const row = inserted.rows[0];

        // Trigger auto-reply if chatting with a core contact or AI assistant
        const otherMembers = await database.query<{ user_id: string; display_name: string; email: string }>(
          `SELECT m.user_id, u.display_name, u.email
           FROM app_conversation_members m
           JOIN app_users u ON u.id = m.user_id
           WHERE m.conversation_id = $1 AND m.user_id <> $2`,
          [conversationId, userId],
        );
        if (notifyPushToUser) {
          const conversation = await database.query<{ name: string }>(
            "SELECT name FROM app_conversations WHERE id = $1",
            [conversationId],
          );
          const notificationBody = text.trim() ||
            (sharedContact
              ? "Shared a contact"
              : voiceNote
                ? "Sent a voice message"
                : attachments?.length
                  ? "Sent an attachment"
                  : "New message");
          for (const recipient of otherMembers.rows) {
            void notifyPushToUser(recipient.user_id, {
              type: "message",
              title: conversation.rows[0]?.name || sender.rows[0]?.display_name || "New message",
              body: notificationBody.slice(0, 240),
              url: `/?conversation=${encodeURIComponent(conversationId)}`,
              conversationId,
              tag: `msg-${conversationId}`,
            }).catch((error: unknown) => {
              logger.warn({
                userId: recipient.user_id,
                errorName: error instanceof Error ? error.name : "UnknownError",
              }, "Could not enqueue a message push notification");
            });
          }
        }
        const coreBot = otherMembers.rows.find((m) =>
          ["ai@connectsphere.io", "alex@connectsphere.io", "sarah@connectsphere.io", "don@connectsphere.io"].includes(m.email)
        );
        if (coreBot) {
          setTimeout(async () => {
            try {
              // Mark user's message as read by bot
              const readMessages = await database.query<{ id: string }>(
                `UPDATE app_message_receipts receipt
                 SET delivered_at = COALESCE(receipt.delivered_at, now()),
                     read_at = COALESCE(receipt.read_at, now()),
                     receipt_state = 'read'
                 FROM app_messages message
                 JOIN app_users reader
                   ON reader.id = $3 AND reader.read_receipts_enabled = true
                 WHERE receipt.message_id = message.id
                   AND receipt.user_id = reader.id
                   AND message.conversation_id = $1
                   AND message.sender_id = $2
                 RETURNING receipt.message_id AS id`,
                [conversationId, userId, coreBot.user_id],
              );
              if (readMessages.rows.length > 0) {
                const readMessageIds = readMessages.rows.map(({ id }) => id);
                await database.query(
                  `UPDATE app_messages
                   SET status = CASE WHEN status = 'read' THEN 'read' ELSE 'delivered' END
                   WHERE id = ANY($1::uuid[])`,
                  [readMessageIds],
                );
                const fullyRead = await database.query<{ id: string }>(
                  `UPDATE app_messages message
                   SET status = 'read'
                   WHERE message.id = ANY($1::uuid[])
                     AND EXISTS (
                       SELECT 1
                       FROM app_message_receipts receipt
                       JOIN app_users recipient ON recipient.id = receipt.user_id
                       JOIN app_conversation_members member
                         ON member.conversation_id = message.conversation_id
                        AND member.user_id = receipt.user_id
                       WHERE receipt.message_id = message.id AND recipient.read_receipts_enabled = true
                     )
                     AND NOT EXISTS (
                       SELECT 1
                       FROM app_message_receipts receipt
                       JOIN app_users recipient ON recipient.id = receipt.user_id
                       JOIN app_conversation_members member
                         ON member.conversation_id = message.conversation_id
                        AND member.user_id = receipt.user_id
                       WHERE receipt.message_id = message.id
                         AND recipient.read_receipts_enabled = true
                         AND receipt.receipt_state <> 'read'
                     )
                   RETURNING message.id`,
                  [readMessageIds],
                );
                if (fullyRead.rows.length > 0) {
                  await notifyReadReceipt?.(
                    conversationId,
                    coreBot.user_id,
                    fullyRead.rows.map(({ id }) => id),
                  );
                }
              }

              let replyText = "Message received! ✨ Everything in ConnectSphere is operating smoothly.";
              const lower = text.toLowerCase();
              if (coreBot.email === "ai@connectsphere.io") {
                if (lower.includes("hi") || lower.includes("hello") || lower.includes("hey") || lower.includes("kya")) {
                  replyText = "Hello! 👋 I'm your Sphere AI Assistant. All features—messaging, voice notes, attachments, and WebRTC calls—are 100% active!";
                } else if (attachments && attachments.length > 0) {
                  replyText = "Got your attachment! Lightbox previews and document downloads are working cleanly.";
                } else if (voiceNote) {
                  replyText = "Received your voice note! Audio waveform rendering and playback are crisp.";
                } else {
                  replyText = `Understood! You said: "${text.slice(0, 60)}". Real-time sync and delivery verified.`;
                }
              } else if (coreBot.email === "alex@connectsphere.io") {
                replyText = "Hey! Thanks for messaging. The dark-first UI looks super polished and responsive. Let me know if you want to test audio/video calling too!";
              } else if (coreBot.email === "sarah@connectsphere.io") {
                replyText = "Hello! PostgreSQL queries and WebRTC data channels are performing with sub-50ms latency. All systems are green!";
              } else if (coreBot.email === "don@connectsphere.io") {
                replyText = "Hey there! Ready to collaborate. You can also test the collaborative whiteboard and shared notes in the Workspace tab.";
              }

              const botMessage = await database.query<{ id: string }>(
                `WITH bot_message AS (
                   INSERT INTO app_messages (conversation_id, sender_id, text, status)
                   VALUES ($1, $2, $3, 'sent')
                   RETURNING id, conversation_id, sender_id
                 ),
                 receipt_insertions AS (
                   INSERT INTO app_message_receipts (message_id, user_id)
                   SELECT bot_message.id, member.user_id
                   FROM bot_message
                   JOIN app_conversation_members member
                     ON member.conversation_id = bot_message.conversation_id
                   WHERE member.user_id <> bot_message.sender_id
                   ON CONFLICT (message_id, user_id) DO NOTHING
                   RETURNING message_id
                 )
                 SELECT id FROM bot_message`,
                [conversationId, coreBot.user_id, replyText],
              );
              await database.query("UPDATE app_conversations SET updated_at = now() WHERE id = $1", [conversationId]);
            } catch (error) {
              logger.error({
                errorName: error instanceof Error ? error.name : "UnknownError",
                conversationId,
              }, "Failed to process core contact auto-reply");
            }
          }, 500);
        }

        response.status(201).json({
          message: toMessage({
            ...row,
            sender_name: sender.rows[0]?.display_name ?? "",
            sender_avatar: sender.rows[0]?.avatar ?? null,
          }),
        });
        return;
      }

      if (!idempotencyKey) {
        throw new Error("Message was not inserted and has no idempotency key.");
      }
      const duplicate = await database.query<MessageRow>(
        `SELECT m.id, m.conversation_id, m.sender_id, u.display_name AS sender_name,
                u.avatar AS sender_avatar, m.text, m.attachments, m.voice_note,
                m.status, m.metadata, m.created_at
         FROM app_messages m JOIN app_users u ON u.id = m.sender_id
         WHERE m.conversation_id = $1 AND m.idempotency_key = $2`,
        [conversationId, idempotencyKey],
      );
      const existing = duplicate.rows[0];
      if (!existing) throw new Error("Idempotent message could not be retrieved after conflict.");
      await database.query(
        `INSERT INTO app_message_receipts (message_id, user_id)
         SELECT $1, member.user_id
         FROM app_conversation_members member
         WHERE member.conversation_id = $2 AND member.user_id <> $3
         ON CONFLICT (message_id, user_id) DO NOTHING`,
        [existing.id, conversationId, userId],
      );
      response.status(200).json({ message: toMessage(existing), duplicate: true });
    } catch (error) {
      if (error instanceof ApiError) {
        next(error);
        return;
      }
      logger.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Failed to persist message");
      next(new ApiError(500, "DATABASE_ERROR", "Could not save message."));
    }
  });

  router.post("/:id/messages/:messageId/poll-votes", async (request, response, next) => {
    const conversationId = request.params["id"] ?? "";
    const messageId = request.params["messageId"] ?? "";
    if (!z.string().uuid().safeParse(messageId).success) {
      next(new ApiError(400, "INVALID_MESSAGE_ID", "A valid message ID is required."));
      return;
    }
    const parsed = PollVoteSchema.safeParse(request.body);
    if (!parsed.success) {
      next(new ApiError(400, "INVALID_POLL_VOTE", "A valid poll option is required."));
      return;
    }

    if (!database) {
      const message = (inMemoryMessages.get(conversationId) ?? []).find((item) => item.id === messageId);
      if (!message) {
        next(new ApiError(404, "MESSAGE_NOT_FOUND", "Message not found."));
        return;
      }
      const pollResult = PollSchema.safeParse(message.metadata["poll"]);
      if (!pollResult.success) {
        next(new ApiError(409, "POLL_NOT_FOUND", "This message does not contain a valid poll."));
        return;
      }
      const userId = parsed.data.userId;
      if (!userId) {
        next(new ApiError(400, "INVALID_POLL_VOTE", "A voter ID is required."));
        return;
      }
      const poll = applyPollVote(pollResult.data, parsed.data.optionId, userId);
      if (!poll) {
        next(new ApiError(404, "POLL_OPTION_NOT_FOUND", "Poll option not found."));
        return;
      }
      message.metadata = { ...message.metadata, poll };
      response.status(200).json({ poll });
      return;
    }

    let client: PoolClient | undefined;
    let transactionStarted = false;
    try {
      const userId = await getUserId(request);
      client = await database.connect();
      await client.query("BEGIN");
      transactionStarted = true;
      const membership = await client.query(
        "SELECT 1 FROM app_conversation_members WHERE conversation_id = $1 AND user_id = $2",
        [conversationId, userId],
      );
      if (membership.rowCount === 0) {
        throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Conversation not found.");
      }
      const message = await client.query<{ metadata: Record<string, unknown> }>(
        "SELECT metadata FROM app_messages WHERE id = $1 AND conversation_id = $2 FOR UPDATE",
        [messageId, conversationId],
      );
      const row = message.rows[0];
      if (!row) {
        throw new ApiError(404, "MESSAGE_NOT_FOUND", "Message not found.");
      }
      const pollResult = PollSchema.safeParse(row.metadata?.["poll"]);
      if (!pollResult.success) {
        throw new ApiError(409, "POLL_NOT_FOUND", "This message does not contain a valid poll.");
      }
      const poll = applyPollVote(pollResult.data, parsed.data.optionId, userId);
      if (!poll) {
        throw new ApiError(404, "POLL_OPTION_NOT_FOUND", "Poll option not found.");
      }

      await client.query(
        `UPDATE app_messages
         SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{poll}', $3::jsonb, true)
         WHERE id = $1 AND conversation_id = $2`,
        [messageId, conversationId, JSON.stringify(poll)],
      );
      await client.query("COMMIT");
      transactionStarted = false;
      response.status(200).json({ poll });
    } catch (error) {
      if (client && transactionStarted) await client.query("ROLLBACK");
      next(error);
    } finally {
      client?.release();
    }
  });

  router.patch("/:id/messages/:messageId", async (request, response, next) => {
    const conversationId = request.params["id"] ?? "";
    const messageId = request.params["messageId"] ?? "";
    if (!z.string().uuid().safeParse(messageId).success) {
      next(new ApiError(400, "INVALID_MESSAGE_ID", "A valid message ID is required."));
      return;
    }
    const parsed = UpdateMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      next(new ApiError(400, "INVALID_MESSAGE_UPDATE", "Valid message changes are required."));
      return;
    }

    if (!database) {
      const message = (inMemoryMessages.get(conversationId) ?? []).find((item) => item.id === messageId);
      if (!message) {
        next(new ApiError(404, "MESSAGE_NOT_FOUND", "Message not found."));
        return;
      }
      const textChanged = parsed.data.text !== undefined && parsed.data.text !== message.text;
      if (textChanged && !parsed.data.text?.trim()) {
        next(new ApiError(400, "EMPTY_MESSAGE", "A message cannot be edited to empty text."));
        return;
      }
      if (textChanged && message.metadata["isDeleted"] === true) {
        next(new ApiError(409, "MESSAGE_NOT_EDITABLE", "Deleted messages cannot be edited."));
        return;
      }
      if (parsed.data.text !== undefined) message.text = parsed.data.text;
      message.metadata = {
        ...message.metadata,
        ...(parsed.data.metadata ?? {}),
        ...(textChanged ? { isEdited: true } : {}),
      };
      response.status(200).json({ updated: true, isEdited: textChanged });
      return;
    }

    try {
      const userId = await getUserId(request);
      await requireMembership(conversationId, userId);
      const existing = await database.query<{ sender_id: string; text: string; attachments: unknown[] | null }>(
        "SELECT sender_id, text, attachments FROM app_messages WHERE id = $1 AND conversation_id = $2",
        [messageId, conversationId],
      );
      const message = existing.rows[0];
      if (!message) {
        next(new ApiError(404, "MESSAGE_NOT_FOUND", "Message not found."));
        return;
      }

      if (message.sender_id !== userId && parsed.data.metadata?.isDeleted === true) {
        let client: PoolClient | undefined;
        let transactionStarted = false;
        let actorRole: string | undefined;
        try {
          client = await database.connect();
          await client.query("BEGIN");
          transactionStarted = true;
          const actor = await client.query<{ role: string; type: string }>(
            `SELECT member.role, conversation.type
             FROM app_conversation_members member
             JOIN app_conversations conversation ON conversation.id = member.conversation_id
             WHERE member.conversation_id = $1 AND member.user_id = $2
             FOR UPDATE`,
            [conversationId, userId],
          );
          actorRole = actor.rows[0]?.role;
          if (
            actor.rows[0]?.type !== "group" ||
            (actorRole !== "owner" && actorRole !== "admin" && actorRole !== "moderator")
          ) {
            throw new ApiError(403, "MESSAGE_MODERATION_FORBIDDEN", "Only group moderators can remove another member's message.");
          }
          const locked = await client.query<{
            sender_id: string;
            attachments: unknown[] | null;
            metadata: Record<string, unknown> | null;
          }>(
            `SELECT sender_id, attachments, metadata
             FROM app_messages
             WHERE id = $1 AND conversation_id = $2
             FOR UPDATE`,
            [messageId, conversationId],
          );
          const lockedMessage = locked.rows[0];
          if (!lockedMessage) {
            throw new ApiError(404, "MESSAGE_NOT_FOUND", "Message not found.");
          }
          if (lockedMessage.metadata?.["isDeleted"] === true) {
            await client.query("COMMIT");
            transactionStarted = false;
            response.status(200).json({ updated: true, moderated: true });
            return;
          }

          await client.query(
            `INSERT INTO app_group_audit_log
             (conversation_id, actor_id, target_user_id, target_message_id, action, details)
             VALUES ($1, $2, $3, $4, 'message_moderated', $5::jsonb)`,
            [
              conversationId,
              userId,
              lockedMessage.sender_id,
              messageId,
              JSON.stringify({ moderatorRole: actorRole }),
            ],
          );
          await removeR2Attachments(conversationId, lockedMessage.attachments);
          await client.query(
            `UPDATE app_messages
             SET text = '🚫 This message was removed by a group moderator',
                 metadata = jsonb_build_object(
                   'isDeleted', true,
                   'moderatedByUserId', $3::text
                 ),
                 attachments = NULL,
                 voice_note = NULL
             WHERE id = $1 AND conversation_id = $2`,
            [messageId, conversationId, userId],
          );
          await client.query("COMMIT");
          transactionStarted = false;
        } catch (error) {
          if (client && transactionStarted) await client.query("ROLLBACK");
          throw error;
        } finally {
          client?.release();
        }

        await notifyDeletedMessage({ messageId, conversationId, deletedBy: userId, moderated: true });
        response.status(200).json({ updated: true, moderated: true });
        return;
      }

      const textChanged = parsed.data.text !== undefined && parsed.data.text !== message.text;
      if (textChanged && !parsed.data.text?.trim()) {
        next(new ApiError(400, "EMPTY_MESSAGE", "A message cannot be edited to empty text."));
        return;
      }

      const access = await getGroupPermissionContext(conversationId, userId);
      if (textChanged && parsed.data.metadata?.isDeleted !== true) {
        requireGroupPermission(access, "sendMessages", "edit messages");
      }
      if (parsed.data.metadata?.["poll"] !== undefined) {
        requireGroupPermission(access, "createPolls", "create polls");
      }
      if (
        (Array.isArray(parsed.data.attachments) && parsed.data.attachments.length > 0) ||
        parsed.data.voiceNote
      ) {
        requireGroupPermission(access, "sendMedia", "send media");
      }

      const isSenderOnlyChange =
        textChanged ||
        parsed.data.metadata?.isDeleted === true ||
        parsed.data.attachments !== undefined ||
        parsed.data.voiceNote !== undefined;
      if (isSenderOnlyChange && message.sender_id !== userId) {
        next(new ApiError(403, "MESSAGE_UPDATE_FORBIDDEN", "Only the message sender can edit or delete it for everyone."));
        return;
      }

      const normalizedAttachments = Array.isArray(parsed.data.attachments)
        ? await normalizeR2Attachments(parsed.data.attachments, conversationId, userId)
        : parsed.data.attachments;
      if (parsed.data.attachments !== undefined) {
        const nextAttachmentIds = new Set(getR2AttachmentIds(normalizedAttachments));
        const removedAttachments = (message.attachments ?? []).filter((attachment) =>
          getR2AttachmentIds([attachment]).some((attachmentId) => !nextAttachmentIds.has(attachmentId))
        );
        await removeR2Attachments(conversationId, removedAttachments);
      }

      const metadata = {
        ...(parsed.data.metadata ?? {}),
        ...(textChanged ? { isEdited: true } : {}),
      };
      const updated = await database.query(
        `UPDATE app_messages
         SET text = COALESCE($1, text),
             metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE($2::jsonb, '{}'::jsonb),
             attachments = CASE WHEN $3 THEN $4::jsonb ELSE attachments END,
             voice_note = CASE WHEN $5 THEN $6::jsonb ELSE voice_note END
         WHERE id = $7 AND conversation_id = $8
           AND ($9::boolean = false OR COALESCE(metadata->>'isDeleted', 'false') <> 'true')`,
        [
          parsed.data.text ?? null,
          Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
          parsed.data.attachments !== undefined,
          normalizedAttachments === null ? null : JSON.stringify(normalizedAttachments),
          parsed.data.voiceNote !== undefined,
          parsed.data.voiceNote === null ? null : JSON.stringify(parsed.data.voiceNote),
          messageId,
          conversationId,
          textChanged,
        ],
      );
      if (textChanged && updated.rowCount === 0) {
        next(new ApiError(409, "MESSAGE_NOT_EDITABLE", "Deleted messages cannot be edited."));
        return;
      }
      if (parsed.data.metadata?.isDeleted === true) {
        await notifyDeletedMessage({
          messageId,
          conversationId,
          deletedBy: userId,
        });
      }
      response.status(200).json({ updated: true });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id/messages/:messageId/pin", async (request, response, next) => {
    const conversationId = request.params["id"] ?? "";
    const messageId = request.params["messageId"] ?? "";
    if (!z.string().uuid().safeParse(messageId).success) {
      next(new ApiError(400, "INVALID_MESSAGE_ID", "A valid message ID is required."));
      return;
    }
    const parsed = PinMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      next(new ApiError(400, "INVALID_MESSAGE_PIN", "A valid pin state is required."));
      return;
    }

    if (!database) {
      response.status(200).json({ isPinned: parsed.data.isPinned });
      return;
    }

    let client: PoolClient | undefined;
    let transactionStarted = false;
    try {
      const userId = await getUserId(request);
      client = await database.connect();
      await client.query("BEGIN");
      transactionStarted = true;
      const membership = await client.query<{ role: string }>(
        "SELECT role FROM app_conversation_members WHERE conversation_id = $1 AND user_id = $2 FOR UPDATE",
        [conversationId, userId],
      );
      if (membership.rowCount === 0) {
        throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Conversation not found.");
      }

      const conversation = await client.query<{
        id: string;
        type: string;
        group_permissions: unknown;
      }>(
        "SELECT id, type, group_permissions FROM app_conversations WHERE id = $1 FOR UPDATE",
        [conversationId],
      );
      const conversationRow = conversation.rows[0];
      if (!conversationRow) {
        throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Conversation not found.");
      }
      if (conversationRow.type === "group") {
        const permissions = GroupPermissionsSchema.parse(
          conversationRow.group_permissions ?? DEFAULT_GROUP_PERMISSIONS,
        );
        if (!canPerformGroupAction(membership.rows[0]?.role ?? "", permissions.pinMessages)) {
          throw new ApiError(403, "GROUP_PERMISSION_DENIED", "Only group admins can pin messages.");
        }
      }
      const message = await client.query(
        "SELECT id FROM app_messages WHERE id = $1 AND conversation_id = $2 FOR UPDATE",
        [messageId, conversationId],
      );
      if (message.rowCount === 0) {
        throw new ApiError(404, "MESSAGE_NOT_FOUND", "Message not found.");
      }

      if (parsed.data.isPinned) {
        await client.query(
          `UPDATE app_messages
           SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{isPinned}', 'false'::jsonb, true)
           WHERE conversation_id = $1 AND id <> $2 AND metadata->>'isPinned' = 'true'`,
          [conversationId, messageId],
        );
      }
      await client.query(
        `UPDATE app_messages
         SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{isPinned}', $3::jsonb, true)
         WHERE id = $1 AND conversation_id = $2`,
        [messageId, conversationId, JSON.stringify(parsed.data.isPinned)],
      );
      await client.query("COMMIT");
      transactionStarted = false;
      response.status(200).json({ isPinned: parsed.data.isPinned });
    } catch (error) {
      if (client && transactionStarted) {
        await client.query("ROLLBACK");
      }
      next(error);
    } finally {
      client?.release();
    }
  });

  router.delete("/:id/messages/:messageId", async (request, response, next) => {
    const conversationId = request.params["id"] ?? "";
    const messageId = request.params["messageId"] ?? "";
    if (!z.string().uuid().safeParse(messageId).success) {
      next(new ApiError(400, "INVALID_MESSAGE_ID", "A valid message ID is required."));
      return;
    }
    if (!database) {
      const list = inMemoryMessages.get(conversationId) ?? [];
      inMemoryMessages.set(conversationId, list.filter((m) => m.id !== messageId));
      response.status(200).json({ deleted: true, ghostUnsend: true });
      return;
    }
    try {
      const userId = await getUserId(request);
      await requireMembership(conversationId, userId);
      const existing = await database.query<{ sender_id: string; attachments: unknown[] | null }>(
        "SELECT sender_id, attachments FROM app_messages WHERE id = $1 AND conversation_id = $2",
        [messageId, conversationId],
      );
      const message = existing.rows[0];
      if (!message) {
        response.status(200).json({ deleted: true, ghostUnsend: true });
        return;
      }
      if (message.sender_id !== userId) {
        next(new ApiError(403, "MESSAGE_DELETE_FORBIDDEN", "Only the message sender can permanently unsend it."));
        return;
      }
      await removeR2Attachments(conversationId, message.attachments);
      await database.query(
        "DELETE FROM app_messages WHERE id = $1 AND conversation_id = $2",
        [messageId, conversationId],
      );
      await notifyDeletedMessage({
        messageId,
        conversationId,
        deletedBy: userId,
        ghostUnsend: true,
      });
      response.status(200).json({ deleted: true, ghostUnsend: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
