import { Composer, GrammyError } from "grammy";
import { askAboutGather } from "../services/openai.js";
import { buildGatherMessage, buildCancelledMessage } from "../utils/message-builder.js";
import { buildGatherKeyboard } from "../utils/keyboard-builder.js";
import { clearGatherTimers, scheduleGatherEvents } from "../services/scheduler.js";
import { buildVacancyMessage } from "../utils/vacancy-notifier.js";

const composer = new Composer();

composer.on("message:text", async (ctx) => {
  const botInfo = ctx.me;
  const text = ctx.message.text;
  const isReplyToBot =
    ctx.message.reply_to_message?.from?.id === botInfo.id;
  const isMentioned = text.includes(`@${botInfo.username}`);

  if (!isReplyToBot && !isMentioned) return;

  const cleanedText = text.replace(`@${botInfo.username}`, "").trim();
  if (!cleanedText) return;

  const chatId = String(ctx.chat.id);
  const userId = String(ctx.from!.id);

  const { text: answer, action } = await askAboutGather(
    cleanedText,
    chatId,
    userId,
    ctx.from!.username ?? null,
    ctx.from!.first_name,
  );

  // Handle side effects from AI tool calls
  if (action?.type === "cancelled" && action.gather.messageId) {
    clearGatherTimers(action.gatherId);

    try {
      await ctx.api.editMessageText(
        chatId,
        parseInt(action.gather.messageId),
        buildCancelledMessage(action.gather),
        { parse_mode: "HTML" },
      );
    } catch (err) {
      if (!(err instanceof GrammyError && err.description.includes("message is not modified"))) {
        console.error("Failed to edit gather message:", err);
      }
    }

    await ctx.api.unpinChatMessage(chatId, parseInt(action.gather.messageId)).catch((err) => console.error("Unpin failed:", err.message));
  }

  if (action?.type === "time_changed" && action.gather.messageId) {
    // Reschedule timers for new time
    scheduleGatherEvents({
      id: action.gatherId,
      chatId,
      time: action.gather.time,
      messageId: action.gather.messageId,
    });

    try {
      await ctx.api.editMessageText(
        chatId,
        parseInt(action.gather.messageId),
        buildGatherMessage(action.gather, action.players),
        {
          reply_markup: buildGatherKeyboard(action.gatherId),
          parse_mode: "HTML",
        },
      );
    } catch (err) {
      if (!(err instanceof GrammyError && err.description.includes("message is not modified"))) {
        console.error("Failed to edit gather message:", err);
      }
    }
  }

  if (action?.type === "roster_changed" && action.gather.messageId) {
    try {
      await ctx.api.editMessageText(
        chatId,
        parseInt(action.gather.messageId),
        buildGatherMessage(action.gather, action.players),
        {
          reply_markup: buildGatherKeyboard(action.gatherId),
          parse_mode: "HTML",
        },
      );
    } catch (err) {
      if (!(err instanceof GrammyError && err.description.includes("message is not modified"))) {
        console.error("Failed to edit gather message:", err);
      }
    }

    if (action.teamReady) {
      const { buildTeamReadyMessage } = await import("../utils/message-builder.js");
      await ctx.api.sendMessage(
        chatId,
        buildTeamReadyMessage(action.gather, action.players),
        { parse_mode: "HTML" },
      );
    }

    if (action.promotedPlayer) {
      const name = action.promotedPlayer.username
        ? `@${action.promotedPlayer.username}`
        : action.promotedPlayer.firstName;
      await ctx.api.sendMessage(
        chatId,
        `🎉 ${name}, звільнилось місце! Тепер ти в основному складі на збір о <b>${action.gather.time}</b>!`,
        { parse_mode: "HTML" },
      );
    }

    if (action.needsTagging) {
      const msg = buildVacancyMessage(action.gather, action.players, String(ctx.me.id));
      if (msg) {
        await ctx.api.sendMessage(chatId, msg, { parse_mode: "HTML" });
      }
    }
  }

  await ctx.reply(answer, {
    reply_parameters: { message_id: ctx.message.message_id },
  });
});

export default composer;
