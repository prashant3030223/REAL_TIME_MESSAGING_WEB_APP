import type { Message } from "./types.js";

export function canForwardMessage(
  message: Pick<Message, "isDeleted" | "expiresAt" | "status">,
  now = Date.now(),
): boolean {
  if (
    message.isDeleted ||
    message.status === "scheduled" ||
    message.status === "pending" ||
    message.status === "failed"
  ) {
    return false;
  }
  if (message.expiresAt === undefined) return true;
  const expiresAt = Date.parse(message.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}
