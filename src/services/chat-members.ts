import { db } from "../db/index.js";
import { chatMembers } from "../db/schema.js";
import { and, eq, notInArray } from "drizzle-orm";

export function trackChatMember(
  chatId: string,
  userId: string,
  username: string | null,
  firstName: string,
) {
  db.insert(chatMembers)
    .values({
      chatId,
      userId,
      username,
      firstName,
      lastSeenAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [chatMembers.chatId, chatMembers.userId],
      set: {
        username,
        firstName,
        lastSeenAt: new Date().toISOString(),
      },
    })
    .run();
}

export function getChatMembersNotInGather(
  chatId: string,
  gatherPlayerUserIds: string[],
  botUserId: string,
): { userId: string; username: string | null; firstName: string }[] {
  const excludeIds = [...gatherPlayerUserIds, botUserId].filter(Boolean);

  if (excludeIds.length === 0) {
    return db
      .select()
      .from(chatMembers)
      .where(eq(chatMembers.chatId, chatId))
      .all();
  }

  return db
    .select()
    .from(chatMembers)
    .where(
      and(
        eq(chatMembers.chatId, chatId),
        notInArray(chatMembers.userId, excludeIds),
      ),
    )
    .all();
}
