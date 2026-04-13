import type { gathers, gatherPlayers } from "../db/schema.js";
import type { InferSelectModel } from "drizzle-orm";

type Gather = InferSelectModel<typeof gathers>;
type GatherPlayer = InferSelectModel<typeof gatherPlayers>;

export function buildGatherMessage(
  gather: Gather,
  players: GatherPlayer[],
): string {
  const count = players.length;
  const max = gather.maxPlayers;

  let text = `<b>⚔️ Збір команди на ${gather.time}</b>\n\n`;
  text += `<b>${count}/${max}</b>\n\n`;
  text += `<b>Склад:</b>\n`;

  const lines: string[] = [];

  for (let i = 0; i < max; i++) {
    const player = players[i];
    if (player) {
      const name = player.username ? `@${player.username}` : player.firstName;
      const icon = player.status === "confirmed" ? "✅" : "⏳";
      lines.push(`${i + 1}/${max} ${name} ${icon}`);
    } else {
      lines.push(`${i + 1}/${max} <i>вільне місце</i>`);
    }
  }

  text += lines.join("\n");

  return text;
}

export function buildTeamReadyMessage(
  gather: Gather,
  players: GatherPlayer[],
): string {
  const mentions = players
    .map((p) => (p.username ? `@${p.username}` : p.firstName))
    .join(", ");

  return `🔥 <b>Команду зібрано!</b>\n\n${mentions}\n\n⏰ Граємо о <b>${gather.time}</b> — всі на місці!`;
}
