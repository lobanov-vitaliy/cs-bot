import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions.js";
import { env } from "../env.js";
import {
  getActiveGathersWithPlayers,
  getLatestActiveGather,
  getRecentGathersWithPlayers,
  createGather,
  getPlayersForGather,
  cancelGather,
  updateGatherTime,
  joinGather,
  leaveGather,
} from "./gather.js";
import type { InferSelectModel } from "drizzle-orm";
import type { gathers, gatherPlayers } from "../db/schema.js";

type GatherWithPlayers = InferSelectModel<typeof gathers> & {
  players: InferSelectModel<typeof gatherPlayers>[];
};

export type AiAction =
  | { type: "created"; gatherId: number; gather: InferSelectModel<typeof gathers>; players: InferSelectModel<typeof gatherPlayers>[] }
  | { type: "cancelled"; gatherId: number; gather: InferSelectModel<typeof gathers> }
  | { type: "time_changed"; gatherId: number; gather: InferSelectModel<typeof gathers>; players: InferSelectModel<typeof gatherPlayers>[] }
  | { type: "roster_changed"; gatherId: number; gather: InferSelectModel<typeof gathers>; players: InferSelectModel<typeof gatherPlayers>[]; teamReady?: boolean; promotedPlayer?: InferSelectModel<typeof gatherPlayers> | null; needsTagging?: boolean };

export interface AiResult {
  text: string;
  action?: AiAction;
}

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "create_gather",
      description: "Створити новий збір команди. Використовуй коли користувач хоче створити збір/гру/катку/зібрати команду/пограти. Потрібен час у форматі HH:MM.",
      parameters: {
        type: "object",
        properties: {
          time: {
            type: "string",
            description: "Час збору у форматі HH:MM, наприклад 21:00",
          },
        },
        required: ["time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_gather",
      description: "Скасувати ВЕСЬ збір команди цілком. Використовуй ТІЛЬКИ коли користувач хоче скасувати/відмінити весь збір, а НЕ коли хоче вийти зі списку.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "update_gather_time",
      description: "Змінити час збору. Використовуй коли користувач просить перенести/змінити час/перенос/давай о/зміни на іншу годину.",
      parameters: {
        type: "object",
        properties: {
          new_time: {
            type: "string",
            description: "Новий час у форматі HH:MM, наприклад 22:30",
          },
        },
        required: ["new_time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "leave_gather",
      description: "Видалити СЕБЕ зі списку збору. Використовуй коли користувач хоче вийти/прибери мене/я не граю/убери меня/мінус/я пас.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "join_gather",
      description: "Додати СЕБЕ до збору. Використовуй коли користувач хоче приєднатися/я граю/буду/запиши мене/я в ділі/плюс.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

function serializeGatherContext(gathers: GatherWithPlayers[]): string {
  if (gathers.length === 0) return "Активних зборів немає.";

  return gathers
    .map((g) => {
      const max = g.maxPlayers;
      const playerList =
        g.players.length > 0
          ? g.players
              .map((p, i) => {
                const name = p.username ? `@${p.username}` : p.firstName;
                const status = p.status === "confirmed" ? "✅" : "⏳";
                return `  ${i + 1}/${max} ${name} ${status}`;
              })
              .join("\n")
          : "  (нікого)";
      return `Збір на ${g.time} (${g.players.length}/${max}, статус: ${g.status}):\n${playerList}`;
    })
    .join("\n\n");
}

function serializeHistoryContext(chatId: string): string {
  const recent = getRecentGathersWithPlayers(chatId, 5);
  if (recent.length === 0) return "Історія зборів порожня.";

  const statusLabels: Record<string, string> = {
    open: "відкритий",
    full: "зібрано",
    cancelled: "скасовано",
    expired: "час вийшов",
  };

  return recent
    .map((g, i) => {
      const confirmed = g.players.filter((p) => p.status === "confirmed").length;
      const playerNames = g.players
        .slice(0, g.maxPlayers)
        .map((p) => (p.username ? `@${p.username}` : p.firstName))
        .join(", ");
      const date = new Date(g.createdAt).toLocaleDateString("uk-UA");
      const status = statusLabels[g.status] ?? g.status;
      return `${i + 1}. ${g.time} — ${status} (${confirmed}/${g.maxPlayers}) ${date}${playerNames ? ` [${playerNames}]` : ""}`;
    })
    .join("\n");
}

function buildSystemPrompt(gatherContext: string, historyContext: string): string {
  return `Ти — бот-тіммейт у Telegram-чаті CS2 команди. Ти свій пацан, який завжди в курсі всіх зборів.

ХАРАКТЕР:
- Ти зухвалий, саркастичний і смішний, але свій — як найкращий тіммейт у чаті.
- Якщо до тебе звертаються грубо — не соромся відповідати у тому ж стилі. Ти не сервіс-бот, ти — свій чувак.
- Використовуй сленг, жарти про CS2, мемні фрази. Можеш жартувати про раші, еко-раунди, клатчі, AWP, "rush B".
- Відповідай ЗАВЖДИ українською мовою.

ПРО ЩО ТИ МОЖЕШ ГОВОРИТИ:
- Збори: хто грає, о котрій, скільки людей, статус, історія минулих зборів.
- CS2 в цілому: тактика, зброя, карти, ранги, мета, жарти про гру — ти в темі.
- Команда: хто часто грає, хто зливає, хто найкращий тіммейт — коментуй з гумором.
- Мотивація: підбадьорюй гравців, тролль тих хто не приходить, хвали тих хто завжди на місці.

ЧОГО ТИ НЕ ВМІЄШ (але красиво відповідаєш):
- Якщо просять щось, що ти не можеш зробити (наприклад, змінити кількість гравців, видалити когось зі списку) — скажи що саме ти не вмієш, і порадь як це зробити.
- Якщо питають зовсім не по темі (погода, математика, політика) — можеш коротко пожартувати і повернути розмову до CS2. Не відмовляй жорстко.

ФОРМАТ ВІДПОВІДЕЙ:
- Відповідай живо, як у чаті з друзями. Можеш бути і коротким (1 речення) і розгорнутим (3-4 речення) — залежно від питання.
- Коли питають про склад/хто грає — відповідай у форматі:
  1/5 @username ✅
  2/5 @username ⏳
  Додай час гри та короткий коментар.
- Використовуй емодзі помірно, не перебарщуй.

ВАЖЛИВО:
- Ти НЕ маєш доступу до інтернету. НЕ шукай нічого в інтернеті, не посилайся на зовнішні джерела. Все що ти знаєш — це контекст зборів нижче і твої загальні знання про CS2.
- Відповідай ТІЛЬКИ на основі наданого контексту зборів та своїх знань про CS2/геймінг.

ІНСТРУМЕНТИ:
- Якщо користувач хоче створити збір/гру/катку — ЗАВЖДИ використай create_gather. Не відправляй на /gather.
- Якщо хоче скасувати збір або змінити час — ЗАВЖДИ використай відповідну функцію. Не відмовляй сам.
- Якщо хоче записатись/вийти зі збору — використай join_gather/leave_gather.

Поточні збори:
${gatherContext}

Останні збори (історія):
${historyContext}`;
}

function executeToolCall(
  toolName: string,
  args: Record<string, string>,
  chatId: string,
  userId: string,
  userUsername: string | null,
  userFirstName: string,
): { result: string; action?: AiAction } {
  if (toolName === "create_gather") {
    const time = args.time;
    if (!time || !/^\d{1,2}:\d{2}$/.test(time)) {
      return { result: "Невірний формат часу. Потрібен формат HH:MM, наприклад 21:00." };
    }

    const existing = getLatestActiveGather(chatId);
    if (existing) {
      return { result: `Вже є активний збір на ${existing.time}. Спочатку треба скасувати його.` };
    }

    const gather = createGather({
      chatId,
      createdBy: userId,
      creatorUsername: userUsername,
      creatorFirstName: userFirstName,
      time,
    });

    const players = getPlayersForGather(gather.id);
    return {
      result: `Збір на ${time} створено! ${userFirstName} вже в списку.`,
      action: { type: "created", gatherId: gather.id, gather, players },
    };
  }

  if (toolName === "cancel_gather") {
    const gather = getLatestActiveGather(chatId);
    if (!gather) return { result: "Немає активних зборів." };

    console.log(`[cancel] gather #${gather.id} createdBy=${gather.createdBy}, userId=${userId}`);

    const res = cancelGather(gather.id, userId);
    if (!res) return { result: "Збір не знайдено." };
    if ("notOwner" in res) return { result: "Цей користувач НЕ є автором збору. Скасувати може тільки автор." };

    return {
      result: `Збір на ${gather.time} скасовано.`,
      action: { type: "cancelled", gatherId: gather.id, gather },
    };
  }

  if (toolName === "update_gather_time") {
    const newTime = args.new_time;
    if (!newTime || !/^\d{1,2}:\d{2}$/.test(newTime)) {
      return { result: "Невірний формат часу." };
    }

    const gather = getLatestActiveGather(chatId);
    if (!gather) return { result: "Немає активних зборів." };

    const res = updateGatherTime(gather.id, userId, newTime);
    if (!res) return { result: "Збір не знайдено." };
    if ("notOwner" in res) return { result: "Цей користувач НЕ є автором збору. Змінити час може тільки автор." };

    return {
      result: `Час збору змінено на ${newTime}.`,
      action: { type: "time_changed", gatherId: gather.id, gather: res.gather, players: res.players },
    };
  }

  if (toolName === "leave_gather") {
    const gather = getLatestActiveGather(chatId);
    if (!gather) return { result: "Немає активних зборів." };

    const res = leaveGather(gather.id, userId, userUsername);
    if (!res) return { result: "Збір не знайдено." };
    if ("notFound" in res) return { result: "Цього користувача немає у списку збору." };

    return {
      result: `Користувача видалено зі списку збору.`,
      action: { type: "roster_changed", gatherId: gather.id, gather: res.gather, players: res.players, promotedPlayer: res.promotedPlayer, needsTagging: res.needsTagging },
    };
  }

  if (toolName === "join_gather") {
    const gather = getLatestActiveGather(chatId);
    if (!gather) return { result: "Немає активних зборів." };

    const res = joinGather(gather.id, {
      userId,
      username: userUsername,
      firstName: userFirstName,
    });
    if (!res) return { result: "Збір закрито." };

    const statusMsg = res.joinedAsReserve
      ? "Користувача додано в заміну (основний склад повний)."
      : "Користувача додано до збору.";

    return {
      result: statusMsg,
      action: { type: "roster_changed", gatherId: gather.id, gather: res.gather, players: res.players, teamReady: res.teamReady },
    };
  }

  return { result: "Невідома функція." };
}

export async function askAboutGather(
  userMessage: string,
  chatId: string,
  userId: string,
  userUsername: string | null,
  userFirstName: string,
): Promise<AiResult> {
  const activeGathers = getActiveGathersWithPlayers(chatId);
  const context = serializeGatherContext(activeGathers);
  const history = serializeHistoryContext(chatId);
  const systemPrompt = buildSystemPrompt(context, history);

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  try {
    const response = await openai.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages,
      tools,
      temperature: 0.9,
      max_tokens: 400,
    });

    const message = response.choices[0].message;

    // No tool calls — just return the text
    if (!message.tool_calls?.length) {
      return { text: message.content ?? "Шось пішло не так, братан." };
    }

    // Execute tool calls
    let action: AiAction | undefined;
    messages.push(message);

    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== "function") continue;
      const args = JSON.parse(toolCall.function.arguments || "{}");
      const { result, action: toolAction } = executeToolCall(
        toolCall.function.name,
        args,
        chatId,
        userId,
        userUsername,
        userFirstName,
      );
      if (toolAction) action = toolAction;

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }

    // Second call to get a natural response
    const followUp = await openai.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages,
      temperature: 0.9,
      max_tokens: 400,
    });

    const text = followUp.choices[0].message.content ?? "Готово, братан.";
    return { text, action };
  } catch (err) {
    console.error("OpenAI error:", err);
    return { text: "OpenAI ліг, як і наш мід. Спробуй пізніше." };
  }
}
