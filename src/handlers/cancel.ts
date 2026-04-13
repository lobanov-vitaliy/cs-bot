import { Composer } from "grammy";
import {
  getActiveGathersForChat,
  cancelGather,
} from "../services/gather.js";
import { buildCancelledMessage } from "../utils/message-builder.js";

const composer = new Composer();

composer.command("cancel", async (ctx) => {
  if (ctx.chat.type === "private") {
    return ctx.reply("Ця команда працює тільки в групових чатах.");
  }

  const chatId = String(ctx.chat.id);
  const userId = String(ctx.from!.id);

  const activeGathers = getActiveGathersForChat(chatId);

  if (activeGathers.length === 0) {
    return ctx.reply("Немає активних зборів для скасування.");
  }

  const latest = activeGathers[0];
  const result = cancelGather(latest.id, userId);

  if (!result) {
    return ctx.reply("Збір не знайдено.");
  }

  if ("notOwner" in result) {
    return ctx.reply("Скасувати збір може тільки той, хто його створив.");
  }

  // Edit original gather message to show cancelled
  if (latest.messageId) {
    await ctx.api.editMessageText(
      chatId,
      parseInt(latest.messageId),
      buildCancelledMessage(latest),
      { parse_mode: "HTML" },
    ).catch(() => {});
  }

  await ctx.reply(`Збір на ${latest.time} скасовано. ❌`);
});

export default composer;
