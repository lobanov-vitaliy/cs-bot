// Must be imported first so OpenTelemetry/Langfuse is initialized before any
// span is created.
import { shutdownTracing } from "./instrumentation.js";
import { bot } from "./bot.js";
import { db } from "./db/index.js";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { restoreActiveGatherTimers } from "./services/scheduler.js";
import { trackChatMember } from "./services/chat-members.js";
import { trackMessage } from "./services/chat-messages.js";
import gatherHandler from "./handlers/gather.js";
import callbackHandler from "./handlers/callback.js";
import cancelHandler from "./handlers/cancel.js";
import aiHandler from "./handlers/ai.js";

// Run migrations on startup
migrate(db, { migrationsFolder: "./src/db/migrations" });

// Restore timers for active gathers (reminders, expiry)
restoreActiveGatherTimers();

// Track chat members and recent messages on every group message.
// NOTE: seeing ordinary messages requires Telegram group privacy mode to be
// OFF for the bot (@BotFather → Bot Settings → Group Privacy → Turn off).
// With privacy on, the bot only receives mentions/replies/commands, so the
// recent-messages context will be sparse.
bot.on("message", (ctx, next) => {
  if (ctx.chat.type !== "private" && ctx.from) {
    const chatId = String(ctx.chat.id);
    trackChatMember(
      chatId,
      String(ctx.from.id),
      ctx.from.username ?? null,
      ctx.from.first_name,
    );

    const text = ctx.message.text ?? ctx.message.caption;
    if (text && text.trim()) {
      trackMessage({
        chatId,
        messageId: String(ctx.message.message_id),
        userId: String(ctx.from.id),
        username: ctx.from.username ?? null,
        firstName: ctx.from.first_name,
        text,
      });
    }
  }
  return next();
});

// Register handlers in order:
// 1. /gather, /history commands (quick shortcuts)
// 2. /cancel command
// 3. Callback buttons (inline keyboard)
// 4. AI handler (handles ALL text via mention/reply)
bot.use(gatherHandler);
bot.use(cancelHandler);
bot.use(callbackHandler);
bot.use(aiHandler);

// Graceful shutdown: stop polling and flush buffered traces to Langfuse.
const shutdown = async () => {
  await bot.stop();
  await shutdownTracing();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

// Start polling
bot.start({
  onStart: (botInfo) => {
    console.log(`Bot @${botInfo.username} started successfully!`);
  },
});
