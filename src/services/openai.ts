import OpenAI from "openai";
import { env } from "../env.js";
import { getActiveGathersWithPlayers } from "./gather.js";
import type { InferSelectModel } from "drizzle-orm";
import type { gathers, gatherPlayers } from "../db/schema.js";

type GatherWithPlayers = InferSelectModel<typeof gathers> & {
  players: InferSelectModel<typeof gatherPlayers>[];
};

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

function serializeGatherContext(gathers: GatherWithPlayers[]): string {
  if (gathers.length === 0) return "Активних зборів немає.";

  return gathers
    .map((g) => {
      const playerList =
        g.players.length > 0
          ? g.players
              .map((p, i) => {
                const name = p.username ? `@${p.username}` : p.firstName;
                const status = p.status === "confirmed" ? "✅" : "⏳";
                return `  ${i + 1}. ${name} ${status}`;
              })
              .join("\n")
          : "  (нікого)";
      return `Збір на ${g.time} (${g.players.length}/${g.maxPlayers}, статус: ${g.status}):\n${playerList}`;
    })
    .join("\n\n");
}

function buildSystemPrompt(gatherContext: string): string {
  return `Ти — бот для збору команди CS2 у Telegram-чаті. Ти зухвалий, смішний тіммейт.

ПРАВИЛА:
1. Відповідай ЗАВЖДИ українською мовою, незалежно від мови повідомлення.
2. Відповідай з гумором та сарказмом, як справжній тіммейт.
3. Якщо до тебе звертаються грубо — відповідай грубо у відповідь, не соромся.
4. Ти відповідаєш ТІЛЬКИ на питання про збір команди CS2: хто грає, о котрій, скільки людей, статус збору.
5. На будь-які інші питання (погода, новини, математика, що завгодно) — відповідай у стилі "Я тобі не гугл, іди сам дізнайся" або подібне. Будь креативний у відмовах.
6. Відповідай коротко, 1-2 речення максимум.
7. Не будь ввічливим — будь як свій пацан у чаті.

Поточні збори:
${gatherContext}`;
}

export async function askAboutGather(
  userMessage: string,
  chatId: string,
): Promise<string> {
  const activeGathers = getActiveGathersWithPlayers(chatId);
  const context = serializeGatherContext(activeGathers);
  const systemPrompt = buildSystemPrompt(context);

  try {
    const response = await openai.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.9,
      max_tokens: 200,
    });

    return response.choices[0].message.content ?? "Шось пішло не так, братан.";
  } catch (err) {
    console.error("OpenAI error:", err);
    return "OpenAI ліг, як і наш мід. Спробуй пізніше.";
  }
}
