import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

export const chatMembers = sqliteTable(
  "chat_members",
  {
    chatId: text("chat_id").notNull(),
    userId: text("user_id").notNull(),
    username: text("username"),
    firstName: text("first_name").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.chatId, table.userId] })],
);

// Rolling log of recent group messages, so the AI can pull broader chat
// context on demand (get_recent_messages tool). Pruned to the newest N rows
// per chat by the chat-messages service — this is not a full archive.
export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chatId: text("chat_id").notNull(),
    messageId: text("message_id").notNull(),
    userId: text("user_id").notNull(),
    username: text("username"),
    firstName: text("first_name").notNull(),
    text: text("text").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("chat_messages_chat_id_id_idx").on(table.chatId, table.id)],
);

export const gathers = sqliteTable("gathers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chatId: text("chat_id").notNull(),
  messageId: text("message_id"),
  time: text("time").notNull(),
  maxPlayers: integer("max_players").notNull().default(5),
  status: text("status", { enum: ["open", "full", "cancelled", "expired"] })
    .notNull()
    .default("open"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
});

export const gatherPlayers = sqliteTable("gather_players", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gatherId: integer("gather_id")
    .notNull()
    .references(() => gathers.id),
  userId: text("user_id").notNull().default(""),
  username: text("username"),
  firstName: text("first_name").notNull(),
  status: text("status", { enum: ["pending", "confirmed"] })
    .notNull()
    .default("pending"),
  joinedAt: text("joined_at").notNull(),
});
