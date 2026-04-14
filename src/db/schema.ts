import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

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
