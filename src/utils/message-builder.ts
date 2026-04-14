import type { gathers, gatherPlayers } from "../db/schema.js";
import type { InferSelectModel } from "drizzle-orm";

type Gather = InferSelectModel<typeof gathers>;
type GatherPlayer = InferSelectModel<typeof gatherPlayers>;

export function buildGatherMessage(
  gather: Gather,
  players: GatherPlayer[],
): string {
  const max = gather.maxPlayers;
  const mainTeam = players.slice(0, max);
  const reserves = players.slice(max);
  const mainCount = mainTeam.length;

  let text = `<b>⚔️ Збір команди на ${gather.time}</b>\n\n`;
  text += `<b>${mainCount}/${max}</b>\n\n`;
  text += `<b>Склад:</b>\n`;

  const lines: string[] = [];

  for (let i = 0; i < max; i++) {
    const player = mainTeam[i];
    if (player) {
      const name = player.username ? `@${player.username}` : player.firstName;
      const icon = player.status === "confirmed" ? "✅" : "⏳";
      lines.push(`${i + 1}/${max} ${icon} ${name}`);
    } else {
      lines.push(`${i + 1}/${max} <i>вільне місце</i>`);
    }
  }

  text += lines.join("\n");

  if (reserves.length > 0) {
    text += `\n\n<b>🔄 Заміна:</b>\n`;
    const reserveLines: string[] = [];
    for (let i = 0; i < reserves.length; i++) {
      const player = reserves[i];
      const name = player.username ? `@${player.username}` : player.firstName;
      const icon = player.status === "confirmed" ? "✅" : "⏳";
      reserveLines.push(`${i + 1}. ${icon} ${name}`);
    }
    text += reserveLines.join("\n");
  }

  return text;
}

export function buildTeamReadyMessage(
  gather: Gather,
  players: GatherPlayer[],
): string {
  const mainTeam = players.slice(0, gather.maxPlayers);
  const mentions = mainTeam
    .map((p) => (p.username ? `@${p.username}` : p.firstName))
    .join(", ");

  return `🔥 <b>Команду зібрано!</b>\n\n${mentions}\n\n⏰ Граємо о <b>${gather.time}</b> — всі на місці!`;
}

export function buildCancelledMessage(gather: Gather): string {
  return `❌ <b>ЗБІР НА ${gather.time} СКАСОВАНО!</b>`;
}

type GatherWithPlayers = Gather & { players: GatherPlayer[] };

const STATUS_MAP: Record<string, { icon: string; label: string }> = {
  open: { icon: "⚔️", label: "Відкритий" },
  full: { icon: "✅", label: "Зібрано" },
  cancelled: { icon: "❌", label: "Скасовано" },
  expired: { icon: "⌛", label: "Час вийшов" },
};

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

export function buildHistoryMessage(gathers: GatherWithPlayers[]): string {
  if (gathers.length === 0) {
    return "📋 Історія зборів порожня.";
  }

  let text = `📋 <b>Останні збори:</b>\n`;

  for (let i = 0; i < gathers.length; i++) {
    const g = gathers[i];
    const { icon, label } = STATUS_MAP[g.status] ?? { icon: "❓", label: g.status };
    const mainTeam = g.players.slice(0, g.maxPlayers);
    const confirmedCount = mainTeam.filter((p) => p.status === "confirmed").length;

    text += `\n<b>${i + 1}.</b> ${icon} <b>${g.time}</b> — ${label}`;

    if (g.status !== "cancelled") {
      text += ` (${confirmedCount}/${g.maxPlayers})`;
    }
    text += "\n";

    if (g.players.length > 0 && g.status !== "cancelled") {
      const playerNames = mainTeam
        .map((p) => {
          const name = p.username ? `@${p.username}` : p.firstName;
          const pIcon = p.status === "confirmed" ? "✅" : "⏳";
          return `${pIcon} ${name}`;
        })
        .join(", ");
      text += `   ${playerNames}\n`;
    }

    text += `   📅 ${formatDate(g.createdAt)}\n`;
  }

  return text;
}

export function buildExpiredMessage(
  gather: Gather,
  players: GatherPlayer[],
): string {
  const max = gather.maxPlayers;
  const mainTeam = players.slice(0, max);
  const reserves = players.slice(max);
  const mainCount = mainTeam.length;

  let text = `⌛ <b>Збір на ${gather.time} — час вийшов</b>\n\n`;
  text += `<b>${mainCount}/${max}</b>\n\n`;
  text += `<b>Склад:</b>\n`;

  const lines: string[] = [];

  for (let i = 0; i < max; i++) {
    const player = mainTeam[i];
    if (player) {
      const name = player.username ? `@${player.username}` : player.firstName;
      const icon = player.status === "confirmed" ? "✅" : "⏳";
      lines.push(`${i + 1}/${max} ${icon} ${name}`);
    } else {
      lines.push(`${i + 1}/${max} <i>вільне місце</i>`);
    }
  }

  text += lines.join("\n");

  if (reserves.length > 0) {
    text += `\n\n<b>🔄 Заміна:</b>\n`;
    const reserveLines: string[] = [];
    for (let i = 0; i < reserves.length; i++) {
      const player = reserves[i];
      const name = player.username ? `@${player.username}` : player.firstName;
      const icon = player.status === "confirmed" ? "✅" : "⏳";
      reserveLines.push(`${i + 1}. ${icon} ${name}`);
    }
    text += reserveLines.join("\n");
  }

  return text;
}
