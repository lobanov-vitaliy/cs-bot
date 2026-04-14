import type { InferSelectModel } from "drizzle-orm";
import type { gathers, gatherPlayers } from "../db/schema.js";
import { getChatMembersNotInGather } from "../services/chat-members.js";

type Gather = InferSelectModel<typeof gathers>;
type GatherPlayer = InferSelectModel<typeof gatherPlayers>;

export function buildVacancyMessage(
  gather: Gather,
  players: GatherPlayer[],
  botUserId: string,
): string | null {
  const spotsLeft = gather.maxPlayers - players.length;
  if (spotsLeft <= 0) return null;

  const playerUserIds = players.map((p) => p.userId).filter(Boolean);
  const nonMembers = getChatMembersNotInGather(gather.chatId, playerUserIds, botUserId);

  const mentions = nonMembers
    .filter((m) => m.username)
    .map((m) => `@${m.username}`)
    .join(" ");

  let text = `🆘 Звільнилось <b>${spotsLeft}</b> ${spotsLeft === 1 ? "місце" : "місця"} у збір на <b>${gather.time}</b>!\n\n`;

  if (mentions) {
    text += `${mentions}\n\n`;
  }

  text += `Хто готовий? Тисніть ✅ <b>Я в ділі</b>!`;
  return text;
}
