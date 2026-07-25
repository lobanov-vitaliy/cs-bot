import { db } from "../db/index.js";
import { chatMessages } from "../db/schema.js";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { env } from "../env.js";

export interface RecentMessage {
  userId: string;
  username: string | null;
  firstName: string;
  text: string;
  createdAt: string;
}

// Prune roughly once every PRUNE_EVERY inserts (keyed off the row id) instead of
// on every message, so a busy chat isn't hit with a delete on each insert.
const PRUNE_EVERY = 25;

/**
 * Store one group text message and, occasionally, prune the chat back down to
 * the newest RECENT_MESSAGES_RETENTION rows. Best-effort: never throws into the
 * message pipeline.
 */
export function trackMessage(msg: {
  chatId: string;
  messageId: string;
  userId: string;
  username: string | null;
  firstName: string;
  text: string;
}): void {
  try {
    const inserted = db
      .insert(chatMessages)
      .values({
        chatId: msg.chatId,
        messageId: msg.messageId,
        userId: msg.userId,
        username: msg.username,
        firstName: msg.firstName,
        text: msg.text,
        createdAt: new Date().toISOString(),
      })
      .returning({ id: chatMessages.id })
      .all();

    const newId = inserted[0]?.id ?? 0;
    if (newId % PRUNE_EVERY === 0) {
      pruneChat(msg.chatId);
    }
  } catch (err) {
    console.error("Failed to track message:", err);
  }
}

/** Delete everything in a chat older than the newest RECENT_MESSAGES_RETENTION rows. */
function pruneChat(chatId: string): void {
  const retention = env.RECENT_MESSAGES_RETENTION;
  const keep = db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(eq(chatMessages.chatId, chatId))
    .orderBy(desc(chatMessages.id))
    .limit(retention)
    .all()
    .map((r) => r.id);

  // Nothing to prune until we actually exceed the retention window.
  if (keep.length < retention) return;

  db.delete(chatMessages)
    .where(
      and(eq(chatMessages.chatId, chatId), notInArray(chatMessages.id, keep)),
    )
    .run();
}

/**
 * Return the newest `limit` messages of a chat in chronological order
 * (oldest first) — the natural reading order for conversation context.
 */
export function getRecentMessages(chatId: string, limit: number): RecentMessage[] {
  const rows = db
    .select({
      userId: chatMessages.userId,
      username: chatMessages.username,
      firstName: chatMessages.firstName,
      text: chatMessages.text,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(eq(chatMessages.chatId, chatId))
    .orderBy(desc(chatMessages.id))
    .limit(limit)
    .all();

  return rows.reverse();
}
