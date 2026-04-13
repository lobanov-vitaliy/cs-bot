import { Composer, GrammyError } from "grammy";
import { askAboutGather } from "../services/openai.js";
import { buildGatherMessage, buildCancelledMessage } from "../utils/message-builder.js";
import { buildGatherKeyboard } from "../utils/keyboard-builder.js";

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

  const { text: answer, action } = await askAboutGather(cleanedText, chatId, userId);

  // Handle side effects from AI tool calls
  if (action?.type === "cancelled" && action.gather.messageId) {
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
  }

  if (action?.type === "time_changed" && action.gather.messageId) {
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

  await ctx.reply(answer, {
    reply_parameters: { message_id: ctx.message.message_id },
  });
});

export default composer;
