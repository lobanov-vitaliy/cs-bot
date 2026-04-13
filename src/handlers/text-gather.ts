import { Composer, GrammyError } from "grammy";
import {
  createGather,
  updateGatherMessageId,
  getPlayersForGather,
  getLatestActiveGather,
  updateGatherTime,
  cancelGather,
} from "../services/gather.js";
import { buildGatherMessage, buildCancelledMessage } from "../utils/message-builder.js";
import { buildGatherKeyboard } from "../utils/keyboard-builder.js";

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

composer.on("message:text", async (ctx, next) => {
  if (ctx.chat.type === "private") return next();

  const text = ctx.message.text;
  const userId = String(ctx.from!.id);
  const chatId = String(ctx.chat.id);

  // Strip bot mention for matching
  const botUsername = ctx.me.username;
  const cleanText = text.replace(new RegExp(`@${botUsername}`, "gi"), "").trim();

  // --- 0. Create gather by natural language ---
  const createMatch = cleanText.match(CREATE_GATHER_PATTERN) || cleanText.match(SHORT_GATHER_PATTERN);
  if (createMatch) {
    const existing = getLatestActiveGather(chatId);
    if (existing) {
      return ctx.reply(`Вже є активний збір на ${existing.time}. Спочатку скасуй його.`);
    }

    const time = createMatch[1];
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

    // Edit original gather message to show cancelled
    if (activeGather.messageId) {
      await ctx.api.editMessageText(
        chatId,
        parseInt(activeGather.messageId),
        buildCancelledMessage(activeGather),
        { parse_mode: "HTML" },
      ).catch(() => {});
    }

    return ctx.reply(`Збір на ${activeGather.time} скасовано. ❌`);
  }

  // --- 3. Try time change by text ---
  const timeChangeMatch = cleanText.match(TIME_CHANGE_PATTERN);
  if (timeChangeMatch) {
    const newTime = timeChangeMatch[1];
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

    return ctx.reply(`Час змінено на ${newTime} ⏰`);
  }

  // No pattern matched — pass to next handler (AI)
  return next();
});

export default composer;
