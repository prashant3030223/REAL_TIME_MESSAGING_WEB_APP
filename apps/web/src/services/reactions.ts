import type { Message } from "./types.js";

export function updateMessageReaction(
  reactions: Message["reactions"],
  emoji: string,
  userId: string,
  isReacting: boolean,
): NonNullable<Message["reactions"]> {
  const updatedReactions = Object.fromEntries(
    Object.entries(reactions ?? {})
      .map(([reactionEmoji, userIds]) => {
        const nextUserIds = reactionEmoji === emoji
          ? userIds.filter((id) => id !== userId)
          : userIds;
        return [reactionEmoji, nextUserIds];
      })
      .filter(([, userIds]) => userIds.length > 0)
  );

  if (isReacting) {
    updatedReactions[emoji] = [...(updatedReactions[emoji] ?? []), userId];
  }

  return updatedReactions;
}
