import { bot } from "../bot.js";
import { db } from "../db/index.js";
import { gathers } from "../db/schema.js";
import { eq, or } from "drizzle-orm";
import { getPlayersForGather } from "./gather.js";
import { buildExpiredMessage } from "../utils/message-builder.js";
import { env } from "../env.js";

const gatherTimers = new Map<
  number,
  { reminder?: NodeJS.Timeout; expiry?: NodeJS.Timeout }
>();

/**
 * Parse a HH:MM time string into a Date object for today in the configured timezone.
 */
export function parseGatherDateTime(timeStr: string): Date | null {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);

  if (hours > 23 || minutes > 59) return null;

  const now = new Date();

  // Get current time of day in the configured timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: env.TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const currentHour = parseInt(
    parts.find((p) => p.type === "hour")!.value,
  );
  const currentMinute = parseInt(
    parts.find((p) => p.type === "minute")!.value,
  );
  const currentSecond = parseInt(
    parts.find((p) => p.type === "second")!.value,
  );

  const currentTotalSeconds =
    currentHour * 3600 + currentMinute * 60 + currentSecond;
  const targetTotalSeconds = hours * 3600 + minutes * 60;

  const diffSeconds = targetTotalSeconds - currentTotalSeconds;

  return new Date(now.getTime() + diffSeconds * 1000);
}

/**
 * Check if a HH:MM time string is in the past (in the configured timezone).
 */
export function isTimeInPast(timeStr: string): boolean {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return false;

  const hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);

  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: env.TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const currentHour = parseInt(
    parts.find((p) => p.type === "hour")!.value,
  );
  const currentMinute = parseInt(
    parts.find((p) => p.type === "minute")!.value,
  );

  const currentTotal = currentHour * 60 + currentMinute;
  const targetTotal = hours * 60 + minutes;

  return targetTotal < currentTotal;
}

/**
 * Schedule reminder (5 min before) and expiry (at gather time) for a gather.
 */
export function scheduleGatherEvents(gather: {
  id: number;
  chatId: string;
  time: string;
  messageId: string | null;
}) {
  clearGatherTimers(gather.id);

  const targetTime = parseGatherDateTime(gather.time);
  if (!targetTime) return;

  const now = Date.now();
  const targetMs = targetTime.getTime();
  const timers: { reminder?: NodeJS.Timeout; expiry?: NodeJS.Timeout } = {};

  // Schedule reminder 5 minutes before
  const reminderMs = targetMs - 5 * 60 * 1000;
  if (reminderMs > now) {
    timers.reminder = setTimeout(() => {
      sendReminder(gather.id, gather.chatId).catch(console.error);
    }, reminderMs - now);
  }

  // Schedule expiry at gather time
  if (targetMs > now) {
    timers.expiry = setTimeout(() => {
      expireGather(gather.id, gather.chatId, gather.messageId).catch(
        console.error,
      );
    }, targetMs - now);
  }

  if (timers.reminder || timers.expiry) {
    gatherTimers.set(gather.id, timers);
  }
}

/**
 * Clear all scheduled timers for a gather.
 */
export function clearGatherTimers(gatherId: number) {
  const timers = gatherTimers.get(gatherId);
  if (timers) {
    if (timers.reminder) clearTimeout(timers.reminder);
    if (timers.expiry) clearTimeout(timers.expiry);
    gatherTimers.delete(gatherId);
  }
}

/**
 * Send a reminder message 5 minutes before the gather.
 */
async function sendReminder(gatherId: number, chatId: string) {
  const gather = db
    .select()
    .from(gathers)
    .where(eq(gathers.id, gatherId))
    .all()[0];

  if (!gather || gather.status === "cancelled" || gather.status === "expired") {
    return;
  }

  const players = getPlayersForGather(gatherId);
  const mentions = players
    .map((p) => (p.username ? `@${p.username}` : p.firstName))
    .join(", ");

  await bot.api.sendMessage(
    chatId,
    `⏰ <b>Через 5 хвилин збір на ${gather.time}!</b>\n\n${mentions}\n\nГотуйтесь! 🎮`,
    { parse_mode: "HTML" },
  );
}

/**
 * Expire a gather when its time has passed.
 */
async function expireGather(
  gatherId: number,
  chatId: string,
  messageId: string | null,
) {
  const gather = db
    .select()
    .from(gathers)
    .where(eq(gathers.id, gatherId))
    .all()[0];

  if (!gather || gather.status === "cancelled" || gather.status === "expired") {
    return;
  }

  // Mark as expired
  db.update(gathers)
    .set({ status: "expired" })
    .where(eq(gathers.id, gatherId))
    .run();

  const players = getPlayersForGather(gatherId);

  // Edit message to show expired status (removes inline keyboard)
  if (messageId) {
    await bot.api
      .editMessageText(
        chatId,
        parseInt(messageId),
        buildExpiredMessage(gather, players),
        { parse_mode: "HTML" },
      )
      .catch(() => {});

    // Unpin the message
    await bot.api
      .unpinChatMessage(chatId, parseInt(messageId))
      .catch(() => {});
  }

  gatherTimers.delete(gatherId);
}

/**
 * Restore timers for all active gathers on bot startup.
 */
export function restoreActiveGatherTimers() {
  const activeGathers = db
    .select()
    .from(gathers)
    .where(or(eq(gathers.status, "open"), eq(gathers.status, "full")))
    .all();

  for (const gather of activeGathers) {
    const targetTime = parseGatherDateTime(gather.time);

    if (!targetTime || targetTime.getTime() <= Date.now()) {
      // Time already passed — expire immediately
      expireGather(gather.id, gather.chatId, gather.messageId).catch(
        console.error,
      );
    } else {
      scheduleGatherEvents(gather);
    }
  }

  if (activeGathers.length > 0) {
    console.log(
      `Restored timers for ${activeGathers.length} active gather(s).`,
    );
  }
}
