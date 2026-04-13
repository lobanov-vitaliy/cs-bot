import { Composer, GrammyError } from "grammy";
import { joinGather, leaveGather } from "../services/gather.js";
import { buildGatherMessage, buildTeamReadyMessage } from "../utils/message-builder.js";
import { buildGatherKeyboard } from "../utils/keyboard-builder.js";

const composer = new Composer();

composer.callbackQuery(/^gather:join:(\d+)$/, async (ctx) => {
  const gatherId = parseInt(ctx.match[1]);

  const result = joinGather(gatherId, {
    userId: String(ctx.from.id),
    username: ctx.from.username ?? null,
    firstName: ctx.from.first_name,
  });

  if (!result) {
    return ctx.answerCallbackQuery({
      text: "Цей збір вже закрито або скасовано.",
      show_alert: true,
    });
  }

  if (result.full) {
    return ctx.answerCallbackQuery({
      text: "Збір вже повний, місць немає!",
      show_alert: true,
    });
  }

  try {
    await ctx.editMessageText(
      buildGatherMessage(result.gather, result.players),
      {
        reply_markup: buildGatherKeyboard(gatherId),
        parse_mode: "HTML",
      },
    );
  } catch (err) {
    if (err instanceof GrammyError && err.description.includes("message is not modified")) {
      // Ignore — text didn't change
    } else {
      throw err;
    }
  }

  if (result.teamReady) {
    await ctx.api.sendMessage(
      result.gather.chatId,
      buildTeamReadyMessage(result.gather, result.players),
      { parse_mode: "HTML" },
    );
  }

  await ctx.answerCallbackQuery();
});

composer.callbackQuery(/^gather:leave:(\d+)$/, async (ctx) => {
  const gatherId = parseInt(ctx.match[1]);

  const result = leaveGather(
    gatherId,
    String(ctx.from.id),
    ctx.from.username ?? null,
  );

  if (!result) {
    return ctx.answerCallbackQuery({
      text: "Збір не знайдено.",
      show_alert: true,
    });
  }

  if (result.notFound) {
    return ctx.answerCallbackQuery({
      text: "Тебе немає у списку.",
      show_alert: true,
    });
  }

  try {
    await ctx.editMessageText(
      buildGatherMessage(result.gather, result.players),
      {
        reply_markup: buildGatherKeyboard(gatherId),
        parse_mode: "HTML",
      },
    );
  } catch (err) {
    if (err instanceof GrammyError && err.description.includes("message is not modified")) {
      // Ignore
    } else {
      throw err;
    }
  }

  await ctx.answerCallbackQuery({ text: "Тебе видалено зі списку." });
});

export default composer;
