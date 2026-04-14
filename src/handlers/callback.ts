import { Composer, GrammyError } from "grammy";
import { joinGather, leaveGather } from "../services/gather.js";
import { buildGatherMessage, buildTeamReadyMessage } from "../utils/message-builder.js";
import { buildGatherKeyboard } from "../utils/keyboard-builder.js";
import { buildVacancyMessage } from "../utils/vacancy-notifier.js";

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

  await ctx.answerCallbackQuery({
    text: result.joinedAsReserve
      ? "Тебе додано в заміну. Якщо хтось відпаде — ти автоматично потрапиш у склад!"
      : "Тебе додано у склад!",
  });
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

  // Notify promoted player
  if (result.promotedPlayer) {
    const name = result.promotedPlayer.username
      ? `@${result.promotedPlayer.username}`
      : result.promotedPlayer.firstName;
    await ctx.api.sendMessage(
      result.gather.chatId,
      `🎉 ${name}, звільнилось місце! Тепер ти в основному складі на збір о <b>${result.gather.time}</b>!`,
      { parse_mode: "HTML" },
    );
  }

  // Tag chat members not in the gather
  if (result.needsTagging) {
    const msg = buildVacancyMessage(result.gather, result.players, String(ctx.me.id));
    if (msg) {
      await ctx.api.sendMessage(result.gather.chatId, msg, { parse_mode: "HTML" });
    }
  }

  await ctx.answerCallbackQuery({ text: "Тебе видалено зі списку." });
});

export default composer;
