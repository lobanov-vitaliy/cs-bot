import { Composer, GrammyError } from "grammy";
import {
  createGather,
  updateGatherMessageId,
  getPlayersForGather,
  getLatestActiveGather,
  updateGatherTime,
  cancelGather,
  joinGather,
  leaveGather,
  addPlayerByCreator,
  removePlayerByCreator,
} from "../services/gather.js";
import { isTimeInPast, scheduleGatherEvents, clearGatherTimers } from "../services/scheduler.js";
import { buildGatherMessage, buildCancelledMessage, buildTeamReadyMessage } from "../utils/message-builder.js";
import { buildGatherKeyboard } from "../utils/keyboard-builder.js";
import { buildVacancyMessage } from "../utils/vacancy-notifier.js";

const composer = new Composer();

// Pattern: lines like "1/5 @username" or "2/5 @username"
const LINEUP_LINE = /^\s*\d+\/\d+\s+@(\S+)/;
const TIME_PATTERN = /\b(\d{1,2}:\d{2})\b/;

// Cancel keywords
const CANCEL_KEYWORDS =
  /^(отмена|відміна|скасувати|скасуй|cancel|отменить|отмените|відмінити)\b/i;

// Time change keywords
const TIME_CHANGE_PATTERN =
  /(?:перенос|переносим|перенести|змінити час|поміняти час|новий час|время|час)\s*(?:на\s*)?(\d{1,2}:\d{2})/i;

// Create gather by text (natural language)
const CREATE_GATHER_PATTERN =
  /(?:создай сбор|створи збір|збір на|сбор на|збери команду|собери команду|катка на|граємо о|играем в|грати о|играть в)\s*(\d{1,2}:\d{2})/i;

// Standalone time with gather intent (e.g. "@bot 21:30" or "катка 21:00")
const SHORT_GATHER_PATTERN =
  /(?:катка|гра|game|cs|кс)\s+(\d{1,2}:\d{2})/i;

// Add player by @username: "+@user", "+ @user", "додай @user", "добавь @user"
const ADD_PLAYER_PATTERN =
  /^(?:\+\s*@(\S+)|(?:додай|добавь|add)\s+@(\S+))$/i;

// Remove player by @username: "-@user", "- @user", "прибери @user", "убери @user", "видали @user"
const REMOVE_PLAYER_PATTERN =
  /^(?:-\s*@(\S+)|(?:прибери|убери|видали|remove)\s+@(\S+))$/i;

// Self-join: "+", "+1", "я +", "я граю", "буду", "я в ділі", "я йду"
const SELF_JOIN_PATTERN = /^(\+1?|я\s*\+|я граю|буду|я в ділі|я йду)$/i;

// Self-leave: "-", "-1", "я -", "пас", "не можу", "не буду", "не граю", "я пас", "мінус"
const SELF_LEAVE_PATTERN = /^(-1?|я\s*-|пас|не можу|не буду|не граю|я пас|мінус)$/i;

composer.on("message:text", async (ctx, next) => {
  if (ctx.chat.type === "private") return next();

  const text = ctx.message.text;
  const botUsername = ctx.me.username;
  const isMentioned = text.includes(`@${botUsername}`);
  const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;

  // Only react to messages where bot is mentioned or replied to
  if (!isMentioned && !isReplyToBot) return next();

  const userId = String(ctx.from!.id);
  const chatId = String(ctx.chat.id);

  // Strip bot mention for matching
  const cleanText = text.replace(new RegExp(`@${botUsername}`, "gi"), "").trim();

  // --- 0. Create gather by natural language ---
  const createMatch = cleanText.match(CREATE_GATHER_PATTERN) || cleanText.match(SHORT_GATHER_PATTERN);
  if (createMatch) {
    const existing = getLatestActiveGather(chatId);
    if (existing) {
      return ctx.reply(`Вже є активний збір на ${existing.time}. Спочатку скасуй його.`);
    }

    const time = createMatch[1];

    if (isTimeInPast(time)) {
      return ctx.reply("Не можна створити збір на час, що вже минув. Вкажи майбутній час.");
    }

    const gather = createGather({
      chatId,
      createdBy: userId,
      creatorUsername: ctx.from!.username ?? null,
      creatorFirstName: ctx.from!.first_name,
      time,
    });

    const players = getPlayersForGather(gather.id);
    const msg = buildGatherMessage(gather, players);
    const keyboard = buildGatherKeyboard(gather.id);

    const sent = await ctx.reply(msg, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });

    updateGatherMessageId(gather.id, String(sent.message_id));

    // Pin the gather message
    await ctx.api.pinChatMessage(ctx.chat.id, sent.message_id, { disable_notification: true }).catch((err) => console.error("Pin failed:", err.message));

    // Schedule reminder and expiry
    scheduleGatherEvents({
      id: gather.id,
      chatId,
      time: gather.time,
      messageId: String(sent.message_id),
    });

    await ctx.deleteMessage().catch(() => {});
    return;
  }

  // --- 1. Try to parse lineup format ---
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const usernames: string[] = [];

  for (const line of lines) {
    const match = line.match(LINEUP_LINE);
    if (match) {
      usernames.push(match[1]);
    }
  }

  if (usernames.length >= 2) {
    const existing = getLatestActiveGather(chatId);
    if (existing) {
      return ctx.reply(`Вже є активний збір на ${existing.time}. Спочатку скасуй його.`);
    }

    // Found a lineup — extract time if present
    const timeMatch = text.match(TIME_PATTERN);
    // Find time that's NOT part of a lineup line (e.g. standalone "21:00")
    let time: string | null = null;
    for (const line of lines) {
      if (!LINEUP_LINE.test(line)) {
        const t = line.match(TIME_PATTERN);
        if (t) {
          time = t[1];
          break;
        }
      }
    }
    // Fallback: check the whole text for time
    if (!time && timeMatch) {
      time = timeMatch[1];
    }

    if (time && time !== "TBD" && isTimeInPast(time)) {
      return ctx.reply("Не можна створити збір на час, що вже минув. Вкажи майбутній час.");
    }

    const gather = createGather({
      chatId,
      createdBy: userId,
      creatorUsername: ctx.from!.username ?? null,
      creatorFirstName: ctx.from!.first_name,
      time: time ?? "TBD",
      initialPlayers: usernames,
    });

    const players = getPlayersForGather(gather.id);
    const msg = buildGatherMessage(gather, players);
    const keyboard = buildGatherKeyboard(gather.id);

    const sent = await ctx.reply(msg, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });

    updateGatherMessageId(gather.id, String(sent.message_id));

    // Pin the gather message
    await ctx.api.pinChatMessage(ctx.chat.id, sent.message_id, { disable_notification: true }).catch((err) => console.error("Pin failed:", err.message));

    // Schedule reminder and expiry (only if time is set)
    if (time && time !== "TBD") {
      scheduleGatherEvents({
        id: gather.id,
        chatId,
        time: gather.time,
        messageId: String(sent.message_id),
      });
    }

    await ctx.deleteMessage().catch(() => {});
    return;
  }

  // --- 2. Try cancel by text ---
  if (CANCEL_KEYWORDS.test(cleanText)) {
    const activeGather = getLatestActiveGather(chatId);
    if (!activeGather) {
      return ctx.reply("Немає активних зборів для скасування.");
    }

    const result = cancelGather(activeGather.id, userId);
    if (!result) return;

    if ("notOwner" in result) {
      return ctx.reply("Скасувати збір може тільки той, хто його створив.");
    }

    // Clear scheduled timers
    clearGatherTimers(activeGather.id);

    // Edit original gather message to show cancelled
    if (activeGather.messageId) {
      await ctx.api.editMessageText(
        chatId,
        parseInt(activeGather.messageId),
        buildCancelledMessage(activeGather),
        { parse_mode: "HTML" },
      ).catch(() => {});

      // Unpin the gather message
      await ctx.api.unpinChatMessage(chatId, parseInt(activeGather.messageId)).catch((err) => console.error("Unpin failed:", err.message));
    }

    return ctx.reply(`Збір на ${activeGather.time} скасовано. ❌`);
  }

  // --- 3. Try time change by text ---
  const timeChangeMatch = cleanText.match(TIME_CHANGE_PATTERN);
  if (timeChangeMatch) {
    const newTime = timeChangeMatch[1];

    if (isTimeInPast(newTime)) {
      return ctx.reply("Не можна перенести збір на час, що вже минув.");
    }

    const activeGather = getLatestActiveGather(chatId);
    if (!activeGather) {
      return ctx.reply("Немає активних зборів для зміни часу.");
    }

    const result = updateGatherTime(activeGather.id, userId, newTime);
    if (!result) return;

    if ("notOwner" in result) {
      return ctx.reply("Змінити час може тільки той, хто створив збір.");
    }

    // Edit the original gather message
    if (activeGather.messageId) {
      try {
        await ctx.api.editMessageText(
          chatId,
          parseInt(activeGather.messageId),
          buildGatherMessage(result.gather, result.players),
          {
            reply_markup: buildGatherKeyboard(activeGather.id),
            parse_mode: "HTML",
          },
        );
      } catch (err) {
        if (err instanceof GrammyError && err.description.includes("message is not modified")) {
          // ignore
        } else {
          console.error("Failed to edit gather message:", err);
        }
      }
    }

    // Reschedule timers for the new time
    if (activeGather.messageId) {
      scheduleGatherEvents({
        id: activeGather.id,
        chatId,
        time: newTime,
        messageId: activeGather.messageId,
      });
    }

    return ctx.reply(`Час змінено на ${newTime} ⏰`);
  }

  // --- 4. Add/remove player by @username ---
  const addPlayerMatch = cleanText.match(ADD_PLAYER_PATTERN);
  if (addPlayerMatch) {
    const targetUsername = (addPlayerMatch[1] || addPlayerMatch[2]).replace(/^@/, "");
    const activeGather = getLatestActiveGather(chatId);
    if (!activeGather) return next();

    // If adding self by own username
    if (ctx.from!.username && targetUsername.toLowerCase() === ctx.from!.username.toLowerCase()) {
      const result = joinGather(activeGather.id, {
        userId,
        username: ctx.from!.username ?? null,
        firstName: ctx.from!.first_name,
      });
      if (!result) return;

      if (activeGather.messageId) {
        try {
          await ctx.api.editMessageText(
            chatId,
            parseInt(activeGather.messageId),
            buildGatherMessage(result.gather, result.players),
            { reply_markup: buildGatherKeyboard(activeGather.id), parse_mode: "HTML" },
          );
        } catch (err) {
          if (!(err instanceof GrammyError && err.description.includes("message is not modified"))) {
            console.error("Failed to edit gather message:", err);
          }
        }
      }

      if (result.teamReady) {
        await ctx.api.sendMessage(
          chatId,
          buildTeamReadyMessage(result.gather, result.players),
          { parse_mode: "HTML" },
        );
      } else if (result.joinedAsReserve) {
        await ctx.reply("Тебе додано в заміну. Якщо хтось відпаде — ти автоматично потрапиш у склад!");
      } else {
        await ctx.reply(buildGatherMessage(result.gather, result.players), { parse_mode: "HTML" });
      }
      return;
    }

    // Creator-only: add another player
    const result = addPlayerByCreator(activeGather.id, userId, targetUsername);
    if (!result) return;
    if ("notOwner" in result) return ctx.reply("Додавати гравців може тільки той, хто створив збір.");
    if ("alreadyIn" in result) return ctx.reply(`@${targetUsername} вже у списку.`);

    if (activeGather.messageId) {
      await ctx.api.editMessageText(
        chatId,
        parseInt(activeGather.messageId),
        buildGatherMessage(result.gather, result.players),
        { reply_markup: buildGatherKeyboard(activeGather.id), parse_mode: "HTML" },
      ).catch(() => {});
    }

    await ctx.reply(buildGatherMessage(result.gather, result.players), { parse_mode: "HTML" });
    return;
  }

  const removePlayerMatch = cleanText.match(REMOVE_PLAYER_PATTERN);
  if (removePlayerMatch) {
    const targetUsername = (removePlayerMatch[1] || removePlayerMatch[2]).replace(/^@/, "");
    const activeGather = getLatestActiveGather(chatId);
    if (!activeGather) return next();

    // If removing self by own username
    if (ctx.from!.username && targetUsername.toLowerCase() === ctx.from!.username.toLowerCase()) {
      const result = leaveGather(activeGather.id, userId, ctx.from!.username ?? null);
      if (!result) return;
      if ("notFound" in result) return ctx.reply("Тебе немає у списку.");

      if (activeGather.messageId) {
        await ctx.api.editMessageText(
          chatId,
          parseInt(activeGather.messageId),
          buildGatherMessage(result.gather, result.players),
          { reply_markup: buildGatherKeyboard(activeGather.id), parse_mode: "HTML" },
        ).catch(() => {});
      }

      if (result.promotedPlayer) {
        const name = result.promotedPlayer.username
          ? `@${result.promotedPlayer.username}`
          : result.promotedPlayer.firstName;
        await ctx.api.sendMessage(
          chatId,
          `🎉 ${name}, звільнилось місце! Тепер ти в основному складі на збір о <b>${result.gather.time}</b>!`,
          { parse_mode: "HTML" },
        );
      }

      if (result.needsTagging) {
        const msg = buildVacancyMessage(result.gather, result.players, String(ctx.me.id));
        if (msg) {
          await ctx.api.sendMessage(chatId, msg, { parse_mode: "HTML" });
        }
      }

      await ctx.reply(buildGatherMessage(result.gather, result.players), { parse_mode: "HTML" });
      return;
    }

    // Creator-only: remove another player
    const result = removePlayerByCreator(activeGather.id, userId, targetUsername);
    if (!result) return;
    if ("notOwner" in result) return ctx.reply("Видаляти гравців може тільки той, хто створив збір.");
    if ("notFound" in result) return ctx.reply(`@${targetUsername} немає у списку.`);

    if (activeGather.messageId) {
      await ctx.api.editMessageText(
        chatId,
        parseInt(activeGather.messageId),
        buildGatherMessage(result.gather, result.players),
        { reply_markup: buildGatherKeyboard(activeGather.id), parse_mode: "HTML" },
      ).catch(() => {});
    }

    if (result.promotedPlayer) {
      const name = result.promotedPlayer.username
        ? `@${result.promotedPlayer.username}`
        : result.promotedPlayer.firstName;
      await ctx.api.sendMessage(
        chatId,
        `🎉 ${name}, звільнилось місце! Тепер ти в основному складі на збір о <b>${result.gather.time}</b>!`,
        { parse_mode: "HTML" },
      );
    }

    if (result.needsTagging) {
      const msg = buildVacancyMessage(result.gather, result.players, String(ctx.me.id));
      if (msg) {
        await ctx.api.sendMessage(chatId, msg, { parse_mode: "HTML" });
      }
    }

    await ctx.reply(buildGatherMessage(result.gather, result.players), { parse_mode: "HTML" });
    return;
  }

  // --- 5. Self join/leave by short text ---
  if (SELF_JOIN_PATTERN.test(cleanText)) {
    const activeGather = getLatestActiveGather(chatId);
    if (!activeGather) return next();

    const result = joinGather(activeGather.id, {
      userId,
      username: ctx.from!.username ?? null,
      firstName: ctx.from!.first_name,
    });
    if (!result) return;

    if (activeGather.messageId) {
      try {
        await ctx.api.editMessageText(
          chatId,
          parseInt(activeGather.messageId),
          buildGatherMessage(result.gather, result.players),
          { reply_markup: buildGatherKeyboard(activeGather.id), parse_mode: "HTML" },
        );
      } catch (err) {
        if (!(err instanceof GrammyError && err.description.includes("message is not modified"))) {
          console.error("Failed to edit gather message:", err);
        }
      }
    }

    if (result.teamReady) {
      await ctx.api.sendMessage(
        chatId,
        buildTeamReadyMessage(result.gather, result.players),
        { parse_mode: "HTML" },
      );
    } else if (result.joinedAsReserve) {
      await ctx.reply("Тебе додано в заміну. Якщо хтось відпаде — ти автоматично потрапиш у склад!");
    } else {
      await ctx.reply(buildGatherMessage(result.gather, result.players), { parse_mode: "HTML" });
    }
    return;
  }

  if (SELF_LEAVE_PATTERN.test(cleanText)) {
    const activeGather = getLatestActiveGather(chatId);
    if (!activeGather) return next();

    const result = leaveGather(activeGather.id, userId, ctx.from!.username ?? null);
    if (!result) return;
    if ("notFound" in result) return;

    if (activeGather.messageId) {
      await ctx.api.editMessageText(
        chatId,
        parseInt(activeGather.messageId),
        buildGatherMessage(result.gather, result.players),
        { reply_markup: buildGatherKeyboard(activeGather.id), parse_mode: "HTML" },
      ).catch(() => {});
    }

    if (result.promotedPlayer) {
      const name = result.promotedPlayer.username
        ? `@${result.promotedPlayer.username}`
        : result.promotedPlayer.firstName;
      await ctx.api.sendMessage(
        chatId,
        `🎉 ${name}, звільнилось місце! Тепер ти в основному складі на збір о <b>${result.gather.time}</b>!`,
        { parse_mode: "HTML" },
      );
    }

    if (result.needsTagging) {
      const msg = buildVacancyMessage(result.gather, result.players, String(ctx.me.id));
      if (msg) {
        await ctx.api.sendMessage(chatId, msg, { parse_mode: "HTML" });
      }
    }

    await ctx.reply(buildGatherMessage(result.gather, result.players), { parse_mode: "HTML" });
    return;
  }

  // No pattern matched — pass to next handler (AI)
  return next();
});

export default composer;
