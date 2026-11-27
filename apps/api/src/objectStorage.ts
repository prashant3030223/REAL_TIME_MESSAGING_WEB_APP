import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "node:stream";
import { ApiError } from "./errors.js";

export type R2ObjectMetadata = Record<string, string>;

export type R2AttachmentStorage = {
  uploadObject(
    key: string,
    body: Readable,
    contentType: string,
    metadata: R2ObjectMetadata,
    contentLength?: number,
  ): Promise<void>;
  headObject(key: string): Promise<{
    contentLength?: number;
    contentType?: string;
    metadata: R2ObjectMetadata;
  }>;
  getObject(key: string): Promise<{
    body: Readable;
    contentLength?: number;
    contentType?: string;
  }>;
  deleteObject(key: string): Promise<void>;
};

function createR2Client(env: NodeJS.ProcessEnv) {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.R2_BUCKET_NAME?.trim();

  if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId) || !accessKeyId || !secretAccessKey || !bucket) {
    throw new ApiError(
      503,
      "ATTACHMENT_STORAGE_NOT_CONFIGURED",
      "Cloudflare R2 attachment storage is not configured.",
    );
  }

  return {
    client: new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
  };
}

export function createR2AttachmentStorage(env: NodeJS.ProcessEnv = process.env): R2AttachmentStorage {
  let configuration: ReturnType<typeof createR2Client> | undefined;
  const getConfiguration = () => {
    configuration ??= createR2Client(env);
    return configuration;
  };

  return {
    async uploadObject(key, body, contentType, metadata, contentLength) {
      const { client, bucket } = getConfiguration();
      const minimumPartSize = 64 * 1024 * 1024;
      const partSize = contentLength && contentLength > 0
        ? Math.max(minimumPartSize, Math.ceil(contentLength / 9_999))
        : minimumPartSize;
      const upload = new Upload({
        client,
        params: {
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          Metadata: metadata,
        },
        queueSize: 1,
        partSize,
        leavePartsOnError: false,
      });
      await upload.done();
    },

    async headObject(key) {
      const { client, bucket } = getConfiguration();
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return {
          ...(result.ContentLength !== undefined ? { contentLength: result.ContentLength } : {}),
          ...(result.ContentType ? { contentType: result.ContentType } : {}),
          metadata: result.Metadata ?? {},
        };
      } catch (error) {
        const statusCode =
          typeof error === "object" && error !== null && "$metadata" in error &&
          typeof error.$metadata === "object" && error.$metadata !== null &&
          "httpStatusCode" in error.$metadata
            ? error.$metadata.httpStatusCode
            : undefined;
        const errorName = error instanceof Error ? error.name : undefined;
        if (statusCode === 404 || errorName === "NotFound" || errorName === "NoSuchKey") {
          throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found.");
        }
        throw error;
      }
    },

    async getObject(key) {
      const { client, bucket } = getConfiguration();
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!(result.Body instanceof Readable)) {
        throw new ApiError(502, "ATTACHMENT_STORAGE_RESPONSE", "Attachment storage returned an invalid file stream.");
      }
      return {
        body: result.Body,
        ...(result.ContentLength !== undefined ? { contentLength: result.ContentLength } : {}),
        ...(result.ContentType ? { contentType: result.ContentType } : {}),
      };
    },

    async deleteObject(key) {
      const { client, bucket } = getConfiguration();
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

export function getR2AttachmentKey(conversationId: string, attachmentId: string): string {
  return `attachments/${conversationId}/${attachmentId}`;
}

export function getR2AttachmentIds(attachments: unknown): string[] {
  if (!Array.isArray(attachments)) return [];
  return attachments.flatMap((attachment) => {
    if (
      typeof attachment === "object" &&
      attachment !== null &&
      "storage" in attachment &&
      attachment.storage === "r2" &&
      "id" in attachment &&
      typeof attachment.id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attachment.id)
    ) {
      return [attachment.id];
    }
    return [];
  });
}

export async function deleteR2Attachments(
  storage: R2AttachmentStorage,
  conversationId: string,
  attachments: unknown,
): Promise<void> {
  const attachmentIds = getR2AttachmentIds(attachments);
  const results = await Promise.allSettled(
    attachmentIds.map((id) => storage.deleteObject(getR2AttachmentKey(conversationId, id))),
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    throw new ApiError(502, "ATTACHMENT_DELETE_FAILED", "Could not delete the attachment from Cloudflare R2.");
  }
}
