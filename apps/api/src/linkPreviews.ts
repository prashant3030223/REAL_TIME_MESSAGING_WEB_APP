import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { ApiError } from "./errors.js";
import type { AppLogger } from "./logger.js";
import { resolveSessionUserId, SESSION_COOKIE_NAME } from "./auth.js";
import type { Pool } from "pg";

const LinkPreviewQuerySchema = z.object({
  url: z.string().min(1).max(2048).url(),
});

const HTML_MAX_BYTES = 64 * 1024;
const IMAGE_MAX_BYTES = 128 * 1024;
const REDIRECT_LIMIT = 3;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const previewCache = new Map<string, { expiresAt: number; preview: LinkPreviewData }>();

export type LinkPreviewData = {
  url: string;
  hostname: string;
  title: string;
  description: string;
  thumbnail?: string;
};

export type LinkPreviewFetcher = (url: string) => Promise<LinkPreviewData>;

class LinkPreviewFetchError extends Error {}

type ExternalResponse = {
  statusCode: number;
  location?: string;
  contentType: string;
  body: Buffer;
};

function isPublicIpv4Address(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [first, second, third] = address.split(".").map(Number);
  if (first === undefined || second === undefined || third === undefined) return false;
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 31 && third === 196) ||
    (first === 192 && second === 52 && third === 193) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 175 && third === 48) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function normalizePublicUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LinkPreviewFetchError("Invalid preview URL.");
  }

  const defaultPort = url.protocol === "https:" ? "443" : "80";
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    (url.port && url.port !== defaultPort) ||
    isIP(url.hostname) !== 0 ||
    !url.hostname.includes(".") ||
    /\.(?:localhost|local|internal|test|invalid|example)$/i.test(url.hostname)
  ) {
    throw new LinkPreviewFetchError("Preview URL is not allowed.");
  }

  url.hash = "";
  return url;
}

function selectPublicIpv4(addresses: Array<{ address: string; family: number }>): string {
  const ipv4Addresses = addresses.filter((address) => address.family === 4);
  if (ipv4Addresses.length === 0 || ipv4Addresses.some(({ address }) => !isPublicIpv4Address(address))) {
    throw new LinkPreviewFetchError("Preview host is not publicly routable.");
  }
  return ipv4Addresses[0]!.address;
}

async function resolvePublicIpv4(hostname: string): Promise<string> {
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dnsLookup(hostname, { all: true as const, verbatim: true });
  } catch {
    throw new LinkPreviewFetchError("Could not resolve preview host.");
  }

  return selectPublicIpv4(addresses);
}

function requestExternalResource(
  url: URL,
  address: string,
  maxBytes: number,
): Promise<ExternalResponse> {
  return new Promise((resolve, reject) => {
    let totalBytes = 0;
    const chunks: Buffer[] = [];
    const lookupPinned: LookupFunction = (_hostname, options, callback) => {
      if (options.all) {
        callback(null, [{ address, family: 4 }]);
      } else {
        callback(null, address, 4);
      }
    };
    const requestOptions = {
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      lookup: lookupPinned,
      headers: {
        accept: "text/html,application/xhtml+xml,image/png,image/jpeg,image/gif",
        "accept-encoding": "identity",
        "user-agent": "ConnectSphere-LinkPreview/1.0",
        range: `bytes=0-${maxBytes - 1}`,
        connection: "close",
      },
    };
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = transport(url, requestOptions, (response: IncomingMessage) => {
      const contentLength = Number(response.headers["content-length"]);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        response.destroy();
        reject(new LinkPreviewFetchError("Preview resource is too large."));
        return;
      }

      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.byteLength;
        if (totalBytes > maxBytes) {
          response.destroy();
          reject(new LinkPreviewFetchError("Preview resource is too large."));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        const contentType = response.headers["content-type"];
        resolve({
          statusCode: response.statusCode ?? 0,
          ...(typeof response.headers.location === "string" ? { location: response.headers.location } : {}),
          contentType: typeof contentType === "string" ? contentType.split(";")[0]!.trim().toLowerCase() : "",
          body: Buffer.concat(chunks),
        });
      });
      response.on("error", () => reject(new LinkPreviewFetchError("Could not read preview resource.")));
    });

    const hardTimeout = setTimeout(
      () => request.destroy(new LinkPreviewFetchError("Preview request timed out.")),
      8000,
    );
    request.setTimeout(4000, () => request.destroy(new LinkPreviewFetchError("Preview request timed out.")));
    request.on("close", () => clearTimeout(hardTimeout));
    request.on("error", () => reject(new LinkPreviewFetchError("Could not fetch preview resource.")));
    request.end();
  });
}

async function fetchExternalResource(
  initialUrl: URL,
  maxBytes: number,
  redirects = 0,
): Promise<{ url: URL; response: ExternalResponse }> {
  const url = normalizePublicUrl(initialUrl.href);
  const address = await resolvePublicIpv4(url.hostname);
  const response = await requestExternalResource(url, address, maxBytes);
  if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.location) {
    if (redirects >= REDIRECT_LIMIT) {
      throw new LinkPreviewFetchError("Too many preview redirects.");
    }
    return fetchExternalResource(new URL(response.location, url), maxBytes, redirects + 1);
  }
  return { url, response };
}

function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (entity, token: string) => {
    if (token.startsWith("#x") || token.startsWith("#X")) {
      const codePoint = Number.parseInt(token.slice(2), 16);
      return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    }
    if (token.startsWith("#")) {
      const codePoint = Number.parseInt(token.slice(1), 10);
      return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    }
    return namedEntities[token.toLowerCase()] ?? entity;
  });
}

function cleanText(value: string | undefined, maxLength: number): string {
  return decodeHtmlEntities((value ?? "").replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function getAttribute(tag: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`, "i").exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function extractMetadata(html: string, pageUrl: URL) {
  const meta = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = (getAttribute(tag, "property") ?? getAttribute(tag, "name") ?? "").toLowerCase();
    const content = getAttribute(tag, "content");
    if (key && content && !meta.has(key)) meta.set(key, content);
  }

  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const title = cleanText(meta.get("og:title") ?? meta.get("twitter:title") ?? titleTag, 160);
  const description = cleanText(
    meta.get("og:description") ?? meta.get("twitter:description") ?? meta.get("description"),
    300,
  );
  const image = meta.get("og:image") ?? meta.get("twitter:image");
  let thumbnailUrl: URL | undefined;
  if (image) {
    try {
      const parsed = new URL(image, pageUrl);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") thumbnailUrl = parsed;
    } catch {
      thumbnailUrl = undefined;
    }
  }
  return { title, description, ...(thumbnailUrl ? { thumbnailUrl } : {}) };
}

function imageDimensionsWithinLimit(image: Buffer, contentType: string): boolean {
  let width = 0;
  let height = 0;
  if (
    contentType === "image/png" &&
    image.length >= 24 &&
    image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    width = image.readUInt32BE(16);
    height = image.readUInt32BE(20);
  } else if (
    contentType === "image/gif" &&
    image.length >= 10 &&
    (image.toString("ascii", 0, 6) === "GIF87a" || image.toString("ascii", 0, 6) === "GIF89a")
  ) {
    width = image.readUInt16LE(6);
    height = image.readUInt16LE(8);
  } else if (
    contentType === "image/jpeg" &&
    image.length >= 4 &&
    image[0] === 0xff &&
    image[1] === 0xd8
  ) {
    let offset = 2;
    while (offset + 4 <= image.length) {
      if (image[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      let marker = image[offset + 1] ?? 0;
      offset += 2;
      while (marker === 0xff && offset < image.length) {
        marker = image[offset] ?? 0;
        offset += 1;
      }
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        continue;
      }
      if (offset + 2 > image.length) break;
      const segmentLength = image.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > image.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (segmentLength < 7) break;
        height = image.readUInt16BE(offset + 3);
        width = image.readUInt16BE(offset + 5);
        break;
      }
      offset += segmentLength;
    }
  }
  return width > 0 && height > 0 && width <= 4096 && height <= 4096 && width * height <= 16_000_000;
}

async function fetchThumbnail(url: URL): Promise<string | undefined> {
  const { response } = await fetchExternalResource(url, IMAGE_MAX_BYTES);
  if (![200, 206].includes(response.statusCode)) {
    return undefined;
  }
  if (!["image/jpeg", "image/png", "image/gif"].includes(response.contentType)) {
    return undefined;
  }
  if (!imageDimensionsWithinLimit(response.body, response.contentType)) {
    return undefined;
  }
  return `data:${response.contentType};base64,${response.body.toString("base64")}`;
}

async function fetchLinkPreview(urlValue: string): Promise<LinkPreviewData> {
  const initialUrl = normalizePublicUrl(urlValue);
  const cached = previewCache.get(initialUrl.href);
  if (cached && cached.expiresAt > Date.now()) return cached.preview;
  if (cached) previewCache.delete(initialUrl.href);

  const { url, response } = await fetchExternalResource(initialUrl, HTML_MAX_BYTES);
  if (
    (response.statusCode !== 200 && response.statusCode !== 206) ||
    !["text/html", "application/xhtml+xml"].includes(response.contentType)
  ) {
    throw new LinkPreviewFetchError("Website did not return an HTML page.");
  }
  const metadata = extractMetadata(response.body.toString("utf8"), url);
  let thumbnail: string | undefined;
  if (metadata.thumbnailUrl) {
    try {
      thumbnail = await fetchThumbnail(metadata.thumbnailUrl);
    } catch (error) {
      if (!(error instanceof LinkPreviewFetchError)) throw error;
    }
  }

  const preview: LinkPreviewData = {
    url: url.href,
    hostname: url.hostname,
    title: metadata.title || url.hostname,
    description: metadata.description,
    ...(thumbnail ? { thumbnail } : {}),
  };
  if (previewCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = previewCache.keys().next().value;
    if (oldestKey) previewCache.delete(oldestKey);
  }
  previewCache.set(initialUrl.href, { expiresAt: Date.now() + CACHE_TTL_MS, preview });
  return preview;
}

function createPreviewRateLimit(logger: AppLogger) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (request: Request, response: Response) => {
      logger.warn({ requestId: response.locals.requestId, route: request.path }, "Link preview rate limit exceeded");
      response.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many link previews. Try again shortly.",
          requestId: response.locals.requestId,
        },
      });
    },
  });
}

export function createLinkPreviewsRouter(
  database: Pool | undefined,
  logger: AppLogger,
  fetcher: LinkPreviewFetcher = fetchLinkPreview,
) {
  const router = Router();
  const limiter = createPreviewRateLimit(logger);

  router.get("/", limiter, async (request, response, next: NextFunction) => {
    try {
      const userId = await resolveSessionUserId(database, request.cookies?.[SESSION_COOKIE_NAME]);
      if (!userId) throw new ApiError(401, "UNAUTHENTICATED", "Sign in to generate link previews.");

      const parsed = LinkPreviewQuerySchema.safeParse({ url: request.query["url"] });
      if (!parsed.success) {
        throw new ApiError(400, "INVALID_LINK_PREVIEW_URL", "Provide a valid website URL.");
      }

      let normalizedUrl: URL;
      try {
        normalizedUrl = normalizePublicUrl(parsed.data.url);
      } catch {
        throw new ApiError(400, "INVALID_LINK_PREVIEW_URL", "Provide a valid website URL.");
      }

      const preview = await fetcher(normalizedUrl.href);
      response.setHeader("Cache-Control", "private, no-store");
      response.status(200).json({ preview });
    } catch (error) {
      if (error instanceof LinkPreviewFetchError) {
        next(new ApiError(502, "LINK_PREVIEW_UNAVAILABLE", "Could not generate a preview for this website."));
        return;
      }
      next(error);
    }
  });

  return router;
}

export const linkPreviewInternals = {
  extractMetadata,
  isPublicIpv4Address,
  imageDimensionsWithinLimit,
  normalizePublicUrl,
  selectPublicIpv4,
};
