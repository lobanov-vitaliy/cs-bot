import { Composer } from "grammy";
import {
  createGather,
  updateGatherMessageId,
  getPlayersForGather,
} from "../services/gather.js";
import { buildGatherMessage } from "../utils/message-builder.js";
import { buildGatherKeyboard } from "../utils/keyboard-builder.js";

const composer = new Composer();

composer.command("gather", async (ctx) => {
  if (ctx.chat.type === "private") {
    return ctx.reply("Ця команда працює тільки в групових чатах.");
  }

  const args = ctx.match?.trim();
  if (!args) {
    return ctx.reply(
      "Використання: /gather ЧЧ:ММ [@user1 @user2 ...]\nПриклад: /gather 21:00 @lobanov_vitaliy @RomanChemerys",
    );
  }

  const parts = args.split(/\s+/);
  const time = parts[0];

  if (!/^\d{1,2}:\d{2}$/.test(time)) {
    return ctx.reply("Невірний формат часу. Використовуй ЧЧ:ММ, наприклад: 21:00");
  }

  // Extract @usernames from remaining args
  const initialPlayers = parts
    .slice(1)
    .filter((p) => p.startsWith("@"))
    .map((p) => p.replace(/^@/, ""));

  const gather = createGather({
    chatId: String(ctx.chat.id),
    createdBy: String(ctx.from!.id),
    time,
    initialPlayers: initialPlayers.length > 0 ? initialPlayers : undefined,
  });

  const players = getPlayersForGather(gather.id);
  const text = buildGatherMessage(gather, players);
  const keyboard = buildGatherKeyboard(gather.id);

  const sent = await ctx.reply(text, {
    reply_markup: keyboard,
    parse_mode: "HTML",
  });

  updateGatherMessageId(gather.id, String(sent.message_id));
});

export default composer;
