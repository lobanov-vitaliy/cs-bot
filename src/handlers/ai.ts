import { Composer } from "grammy";
import { askAboutGather } from "../services/openai.js";

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

  const answer = await askAboutGather(cleanedText, String(ctx.chat.id));
  await ctx.reply(answer, {
    reply_parameters: { message_id: ctx.message.message_id },
  });
});

export default composer;
