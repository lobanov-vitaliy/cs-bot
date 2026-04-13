import { Bot } from "grammy";
import { env } from "./env.js";

export const bot = new Bot(env.BOT_TOKEN);

bot.catch((err) => {
  console.error("Bot error:", err);
});
