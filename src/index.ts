import { bot } from "./bot.js";
import { db } from "./db/index.js";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { restoreActiveGatherTimers } from "./services/scheduler.js";
import { trackChatMember } from "./services/chat-members.js";
import gatherHandler from "./handlers/gather.js";
import callbackHandler from "./handlers/callback.js";
import cancelHandler from "./handlers/cancel.js";
import textGatherHandler from "./handlers/text-gather.js";
import aiHandler from "./handlers/ai.js";

// Run migrations on startup
migrate(db, { migrationsFolder: "./src/db/migrations" });

// Restore timers for active gathers (reminders, expiry)
restoreActiveGatherTimers();

// Track chat members on every group message
bot.on("message", (ctx, next) => {
  if (ctx.chat.type !== "private" && ctx.from) {
    trackChatMember(
      String(ctx.chat.id),
      String(ctx.from.id),
      ctx.from.username ?? null,
      ctx.from.first_name,
    );
  }
  return next();
});

// Register handlers in order:
// 1. /gather command
// 2. /cancel command
// 3. Callback buttons (inline keyboard)
// 4. Text-based gather (lineup format, cancel text, time change)
// 5. AI handler (mention/reply — must be last)
bot.use(gatherHandler);
bot.use(cancelHandler);
bot.use(callbackHandler);
bot.use(textGatherHandler);
bot.use(aiHandler);

// Start polling
bot.start({
  onStart: (botInfo) => {
    console.log(`Bot @${botInfo.username} started successfully!`);
  },
});
